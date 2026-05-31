"use client"

import { createContext, useReducer, useContext, ReactNode, useEffect, useState } from 'react'
import type { Post } from '@/lib/types'
import { getPostsWithPinned } from '@/lib/supabase-optimized'
import { supabase } from '@/lib/supabaseClient'
import { useSimpleAuth } from '@/contexts/auth-context-simple'

// 添加帖子缓存（按分类）
// key: category 值，null 对应 "__all__"
const postCacheByCategory = new Map<string, { posts: Post[]; time: number }>();
const CACHE_TTL = 10000; // 缓存有效期10秒

const CACHE_KEY_ALL = "__all__";
const catKey = (c: string | null) => c ?? CACHE_KEY_ALL;

// 强制清理缓存的函数（清理所有分类）
export function clearPostsCache() {
  postCacheByCategory.clear();
  console.debug('🧹 PostsContext: 缓存已清理');
}

// 注：不在模块加载时强制清理缓存，10s TTL 已由 loadPosts 负责
let loadingFailed = false; // 标记加载是否失败过
let retryCount = 0; // 重试计数
const MAX_RETRIES = 3; // 最大重试次数

// 定义页面大小常量
const PAGE_SIZE = 30;

// 定义状态和操作类型
export type PostsState = {
  posts: Post[]
  isLoading: boolean
  hasMore: boolean
  page: number
  error: string | null
  category: string | null
}

export type PostsAction = 
  | { type: 'LOAD_POSTS', payload: Post[] }
  | { type: 'LOAD_MORE_POSTS', payload: Post[] }
  | { type: 'SET_LOADING', payload: boolean }
  | { type: 'SET_HAS_MORE', payload: boolean }
  | { type: 'SET_PAGE', payload: number }
  | { type: 'SET_ERROR', payload: string | null }
  | { type: 'SET_CATEGORY', payload: string | null }
  | { type: 'ADD_POST', payload: Post }
  | { type: 'DELETE_POST', payload: string }
  | { type: 'UPDATE_POST', payload: { id: string, updates: Partial<Post> } }

// 帖子reducer
function postsReducer(state: PostsState, action: PostsAction): PostsState {
  switch (action.type) {
    case 'LOAD_POSTS':
      console.debug('📦 Reducer LOAD_POSTS:', {
        newPostsCount: action.payload.length,
        oldPostsCount: state.posts.length
      });
      return { 
        ...state, 
        posts: action.payload, 
        isLoading: false,
        error: null,
        page: 1
      }
    case 'LOAD_MORE_POSTS':
      // 过滤重复帖子
      const existingIds = new Set(state.posts.map(post => post.id))
      const newPosts = action.payload.filter(post => !existingIds.has(post.id))
      
      return { 
        ...state, 
        posts: [...state.posts, ...newPosts],
        page: state.page + 1
      }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_HAS_MORE':
      return { ...state, hasMore: action.payload }
    case 'SET_PAGE':
      return { ...state, page: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'SET_CATEGORY':
      return { ...state, category: action.payload, page: 0, posts: [] }
    case 'ADD_POST':
      // 添加新帖子到顶部
      return { 
        ...state, 
        posts: [action.payload, ...state.posts] 
      }
    case 'DELETE_POST':
      return { 
        ...state, 
        posts: state.posts.filter(post => post.id !== action.payload)
      }
    case 'UPDATE_POST':
      return {
        ...state,
        posts: state.posts.map(post => 
          post.id === action.payload.id 
            ? { ...post, ...action.payload.updates } 
            : post
        )
      }
    default:
      return state
  }
}

// 创建Context
type PostsContextType = {
  state: PostsState
  dispatch: React.Dispatch<PostsAction>
  loadPosts: () => Promise<void>
  loadMorePosts: (page: number, limit: number) => Promise<void>
  addPost: (post: Post) => void
  deletePost: (postId: string) => void
  updatePost: (postId: string, updates: Partial<Post>) => void
  retryLoading: () => Promise<void>
  setCategory: (category: string | null) => void
}

const PostsContext = createContext<PostsContextType | undefined>(undefined)

// 创建Provider
export function PostsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(postsReducer, {
    posts: [],
    isLoading: true,
    hasMore: true,
    page: 0,
    error: null,
    category: null,
  })

  // 用于 addPost 时优先用当前登录用户自己的用户名（零延迟，无需查 profiles）
  const { user } = useSimpleAuth()
  
  // 加载帖子 - 增强版本
  const loadPosts = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      dispatch({ type: 'SET_ERROR', payload: null })
      
      const currentCategory = state.category;
      const cacheKey = catKey(currentCategory);
      const cached = postCacheByCategory.get(cacheKey);

      // 检查缓存是否有效
      const now = Date.now();
      if (cached && cached.posts.length > 0 && (now - cached.time < CACHE_TTL) && !loadingFailed) {
        // 使用缓存数据
        dispatch({ type: 'LOAD_POSTS', payload: cached.posts })
        dispatch({ type: 'SET_HAS_MORE', payload: cached.posts.length >= PAGE_SIZE })
        dispatch({ type: 'SET_LOADING', payload: false })
        return;
      }
      
      // 获取新数据，包含置顶帖子（按分类过滤）
      const fetchedPosts = await getPostsWithPinned(0, PAGE_SIZE, currentCategory);
      
      // 检查是否获取到了帖子
      if (fetchedPosts.length === 0 && !loadingFailed && retryCount < MAX_RETRIES) {
        // 增加重试计数
        retryCount++;
        loadingFailed = true;
        
        console.warn(`获取帖子为空，尝试重试(${retryCount}/${MAX_RETRIES})...`);
        
        // 如果有缓存数据，先显示缓存数据，避免空白页面
        if (cached && cached.posts.length > 0) {
          console.debug('🔄 显示缓存数据，避免空白页面');
          dispatch({ type: 'LOAD_POSTS', payload: cached.posts });
          dispatch({ type: 'SET_HAS_MORE', payload: cached.posts.length >= PAGE_SIZE });
          dispatch({ type: 'SET_LOADING', payload: false });
        } else {
          // 没有缓存数据时，保持加载状态，显示加载指示器
          dispatch({ type: 'SET_LOADING', payload: true });
          dispatch({ type: 'SET_ERROR', payload: '正在重新加载帖子...' });
        }
        
        // 延迟重试以避免连续失败
        setTimeout(() => {
          loadPosts();
        }, 1000 * retryCount); // 逐渐增加延迟
        
        return;
      }
      
      // 如果获取到了帖子，重置失败标记
      if (fetchedPosts.length > 0) {
        loadingFailed = false;
        retryCount = 0;
        
        // 更新缓存
        postCacheByCategory.set(cacheKey, { posts: fetchedPosts, time: now });
      }
      
      console.debug('✅ PostsContext: 成功加载帖子', {
        count: fetchedPosts.length,
        hasMore: fetchedPosts.length >= PAGE_SIZE,
        category: currentCategory,
      });
      
      dispatch({ type: 'LOAD_POSTS', payload: fetchedPosts })
      dispatch({ type: 'SET_HAS_MORE', payload: fetchedPosts.length >= PAGE_SIZE })
    } catch (error) {
      console.error('❌ PostsContext: 加载帖子失败:', error);
      dispatch({ type: 'SET_ERROR', payload: '加载帖子失败，请尝试刷新' });
      
      // 标记加载失败
      loadingFailed = true;
      
      // 如果失败但有缓存，使用缓存数据
      const cached = postCacheByCategory.get(catKey(state.category));
      if (cached && cached.posts.length > 0) {
        dispatch({ type: 'LOAD_POSTS', payload: cached.posts });
        // 但不覆盖错误信息，保持提示用户有问题
      }
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }
  
  // 添加防抖变量，避免短时间内频繁调用
  let lastRetryTime = 0;
  const RETRY_COOLDOWN = 1000; // 1秒内不允许重复调用
  
  // 手动重试加载
  const retryLoading = async () => {
    // 防抖机制：检查上次调用时间
    const now = Date.now();
    if (now - lastRetryTime < RETRY_COOLDOWN) {
      // 如果调用太频繁，忽略本次调用
      return;
    }
    
    // 更新上次调用时间
    lastRetryTime = now;
    
    // 重置状态
    loadingFailed = false;
    retryCount = 0;
    
    // 清除所有缓存
    postCacheByCategory.clear();
    
    // 重新加载
    await loadPosts();
  }
  
  // 加载更多帖子 - 支持分页，包含置顶帖子处理
  const loadMorePosts = async (page: number, limit: number) => {
    if (state.isLoading || !state.hasMore) return;
    
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });
      
      // 使用传入的页码和大小，如果没提供则使用默认值
      const pageToLoad = page || state.page + 1;
      const pageSize = limit || PAGE_SIZE;
      const currentCategory = state.category;
      const cacheKey = catKey(currentCategory);
      
      console.debug(`📄 加载第${pageToLoad}页帖子，每页${pageSize}条，分类=${currentCategory ?? '全部'}`);
      const morePosts = await getPostsWithPinned(pageToLoad, pageSize, currentCategory);
      if (morePosts.length === 0) {
        dispatch({ type: 'SET_HAS_MORE', payload: false });
        return;
      }
      
      // 更新缓存（合并到当前分类的缓存里）
      if (morePosts.length > 0) {
        const prev = postCacheByCategory.get(cacheKey)?.posts ?? [];
        const newIds = new Set(morePosts.map(p => p.id));
        const merged = [...prev.filter(p => !newIds.has(p.id)), ...morePosts];
        postCacheByCategory.set(cacheKey, { posts: merged, time: Date.now() });
      }
      
      dispatch({ type: 'LOAD_MORE_POSTS', payload: morePosts });
      dispatch({ type: 'SET_HAS_MORE', payload: morePosts.length >= pageSize });
    } catch (error) {
      console.error('加载更多帖子失败:', error);
      // 不显示错误，只是停止加载更多
      dispatch({ type: 'SET_HAS_MORE', payload: false });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }
  
  // 添加帖子 - 乐观更新UI
  // username 解析优先级：
  //   1. post.username 已传入（调用方明确给了）
  //   2. 自己发的帖 → 直接用当前用户的 metadata.username（零延迟）
  //   3. 别人发的帖（realtime 推送）→ 先用兜底占位，后台异步查 profiles 拿真名再 dispatch UPDATE_POST
  // 之所以拆"先占位 + 后修正"是为了不阻塞 UI：用户看到的延迟约 200ms 的名字闪烁，比看到"用户_xxx"几秒后才纠正友好得多
  const addPost = (post: Post) => {
    const ownerId = post.user_id
    const fallback = `用户_${ownerId.substring(0, 6)}`

    // 解析初始 username
    let initialUsername = post.username
    if (!initialUsername && user && ownerId === user.id) {
      // 自己刚发的帖：metadata 已经在内存里，直接用
      initialUsername = (user.user_metadata?.username as string | undefined) || undefined
    }

    const completePost: Post = {
      ...post,
      likes: post.likes ?? 0,
      comments: post.comments ?? 0,
      likes_count: post.likes_count ?? 0,
      comments_count: post.comments_count ?? 0,
      username: initialUsername ?? fallback,
      imageContent: post.image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)],
    }

    // 新帖子影响所有分类缓存：全部作废最安全
    postCacheByCategory.clear()

    dispatch({ type: 'ADD_POST', payload: completePost })

    // 如果初始名是兜底占位，后台异步查 profiles 拿真名再修正
    if (!initialUsername) {
      void supabase
        .from('profiles')
        .select('username')
        .eq('id', ownerId)
        .single()
        .then(({ data, error }) => {
          if (error || !data?.username) return // 查不到就保持兜底名，下次 loadPosts 会拉到真名
          if (data.username === fallback) return
          dispatch({
            type: 'UPDATE_POST',
            payload: {
              id: post.id,
              updates: { username: data.username },
            },
          })
        })
    }
  }
  
  // 删除帖子 - 乐观更新UI
  const deletePost = (postId: string) => {
    // 从所有分类缓存里剔除
    for (const [key, entry] of postCacheByCategory.entries()) {
      postCacheByCategory.set(key, {
        posts: entry.posts.filter(p => p.id !== postId),
        time: entry.time,
      });
    }
    
    dispatch({ type: 'DELETE_POST', payload: postId });
  }
  
  // 更新帖子 - 乐观更新UI
  const updatePost = (postId: string, updates: Partial<Post>) => {
    // 所有分类缓存里的这条帖子都要更新
    for (const [key, entry] of postCacheByCategory.entries()) {
      postCacheByCategory.set(key, {
        posts: entry.posts.map(p => (p.id === postId ? { ...p, ...updates } : p)),
        time: entry.time,
      });
    }
    
    dispatch({ 
      type: 'UPDATE_POST', 
      payload: { id: postId, updates }
    })
  }

  // 切换分类：清当前列表，触发重新加载
  const setCategory = (category: string | null) => {
    dispatch({ type: 'SET_CATEGORY', payload: category });
  }
  
  // 初始加载
  useEffect(() => {
    loadPosts();
    
    // 添加窗口焦点事件监听器，用户返回页面时刷新
    const handleFocus = () => {
      // 如果当前分类缓存距离上次加载超过1分钟，自动刷新
      const entry = postCacheByCategory.get(catKey(state.category));
      if (!entry || Date.now() - entry.time > 60000) {
        loadPosts();
      }
    };
    
    // 跟踪上一次处理认证变化的时间
    let lastAuthChangeTime = 0;
    const AUTH_CHANGE_COOLDOWN = 2000; // 2秒冷却时间
    
    // 监听认证状态变化事件
    const handleAuthChange = () => {
      const now = Date.now();
      // 防止频繁处理认证变化
      if (now - lastAuthChangeTime < AUTH_CHANGE_COOLDOWN) {
        return;
      }
      
      lastAuthChangeTime = now;
      console.debug('🔄 PostsContext: 处理认证状态变化');
      
      // 如果当前有帖子数据，不要立即清空，而是在后台刷新
      if (state.posts.length > 0) {
        console.debug('📝 保持当前帖子显示，后台刷新数据');
        // 清除所有分类缓存但保持UI显示
        postCacheByCategory.clear();
        loadingFailed = false;
        retryCount = 0;
        
        // 后台加载新数据
        loadPosts();
      } else {
        // 如果没有帖子数据，使用完整的重试逻辑
        retryLoading();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    window.addEventListener('auth-state-changed', handleAuthChange);
    
    // 检查localStorage变化
    const authRefreshTimestamp = localStorage.getItem('auth_refresh_timestamp');
    if (authRefreshTimestamp && Date.now() - Number(authRefreshTimestamp) < 10000) {
      console.debug('🔄 PostsContext: 检测到认证时间戳刚更新，重载帖子');
      handleAuthChange();
    }
    
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('auth-state-changed', handleAuthChange);
    };
  }, [state.category]); // 分类变化时重新加载
  
  // 实时订阅帖子变更 - 优化版本
  // 减少依赖于state.posts的频繁重新渲染
  useEffect(() => {
    try {
      // 帖子ID集合的引用，用于追踪哪些帖子已存在
      const existingPostIds = new Set(state.posts.map(post => post.id));
      
      // 订阅帖子表的变更
      const channel = supabase
        .channel('posts-changes')
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'posts' 
        }, (payload) => {
          // 接收到新帖子通知，但只有在列表顶部更新，避免重复
          const newPost = payload.new as Post;
          
          // 使用集合检查帖子是否已存在(更高效)
          if (!existingPostIds.has(newPost.id)) {
            console.debug('收到新帖子:', newPost.id);
            // 更新本地跟踪集合
            existingPostIds.add(newPost.id);
            addPost(newPost);
          }
        })
        .on('postgres_changes', {
          event: 'DELETE',
          schema: 'public',
          table: 'posts'
        }, (payload) => {
          const deletedId = payload.old.id as string;
          console.debug('帖子被删除:', deletedId);
          deletePost(deletedId);
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'posts'
        }, (payload) => {
          const updatedPost = payload.new as Post;
          console.debug('帖子被更新:', updatedPost.id);
          updatePost(updatedPost.id, updatedPost);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      }
    } catch (error) {
      console.error('设置实时订阅失败:', error);
    }
  // 使用空依赖，避免频繁重新订阅
  }, []);
  
  return (
    <PostsContext.Provider 
      value={{ 
        state, 
        dispatch, 
        loadPosts,
        loadMorePosts,
        addPost,
        deletePost,
        updatePost,
        retryLoading,
        setCategory,
      }}
    >
      {children}
    </PostsContext.Provider>
  )
}

// 使用帖子Context的Hook
export function usePosts() {
  const context = useContext(PostsContext);
  if (context === undefined) {
    throw new Error('usePosts must be used within a PostsProvider');
  }
  return context;
} 