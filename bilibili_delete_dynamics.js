// B站批量删除抽奖动态脚本 (DOM操作版)
// 使用方法：打开 https://t.bilibili.com/ ，按F12打开Console，粘贴运行

(async () => {
  // ============ 配置区 ============
  const CONFIG = {
    // 抽奖关键词
    keywords: ['抽奖', '转发抽奖', '互动抽奖', '福利', '转发送', '天选'],
    // 操作间隔（秒）
    delay: 1.5,
    // 是否自动删除（false = 只预览）
    autoDelete: false,
    // 每次删除前是否弹窗确认
    confirmEach: true,
  };

  // ============ 工具函数 ============
  const sleep = sec => new Promise(r => setTimeout(r, sec * 1000));

  const log = (msg, type = 'info') => {
    const styles = {
      info: 'color: #00a1d6; font-weight: bold',
      warn: 'color: #ff6699; font-weight: bold',
      success: 'color: #00b35e; font-weight: bold',
      error: 'color: #ff4444; font-weight: bold',
    };
    console.log(`%c[动态清理] ${msg}`, styles[type] || styles.info);
  };

  // ============ 检查页面 ============
  if (!location.href.includes('bilibili.com')) {
    log('请在B站页面运行此脚本！', 'error');
    return;
  }

  // ============ 滚动加载更多动态 ============
  async function scrollAndLoad(times = 5) {
    log('正在滚动加载更多动态...');
    for (let i = 0; i < times; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1);
      log(`滚动 ${i + 1}/${times}`);
    }
    window.scrollTo(0, 0);
    await sleep(0.5);
  }

  // ============ 获取页面上的动态 ============
  function getDynamicItems() {
    // B站动态的DOM结构，选择器可能需要根据页面更新调整
    const selectors = [
      '.bili-dyn-list__item',           // 主要动态列表
      '.dyn-card',                       // 备用选择器
      '[class*="dyn-item"]',            // 模糊匹配
    ];

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        log(`使用选择器: ${sel}, 找到 ${items.length} 条动态`);
        return Array.from(items);
      }
    }

    log('未找到动态元素，可能需要调整选择器', 'error');
    return [];
  }

  // ============ 判断是否为抽奖动态 ============
  function isLotteryItem(item) {
    const text = item.innerText || '';
    const lowerText = text.toLowerCase();

    // 检查是否包含关键词
    const hasKeyword = CONFIG.keywords.some(kw => lowerText.includes(kw.toLowerCase()));

    // 排除：如果是视频投稿（包含播放量等信息）
    const isVideo = item.querySelector('[class*="video"]') || 
                    item.querySelector('[class*="archive"]') ||
                    /\d+万?\s*播放/.test(text);

    return hasKeyword && !isVideo;
  }

  // ============ 获取动态预览文本 ============
  function getPreviewText(item) {
    const text = item.innerText || '';
    // 截取前80个字符作为预览
    return text.replace(/\n/g, ' ').substring(0, 80).trim() + '...';
  }

  // ============ 删除单条动态 ============
  async function deleteDynamic(item, index) {
    // 找到"更多"按钮
    const moreBtn = item.querySelector('.bili-dyn-more__btn') ||
                    item.querySelector('[class*="more"]') ||
                    item.querySelector('.tp.bili-dyn-more__btn');

    if (!moreBtn) {
      log(`第 ${index} 条: 未找到更多按钮`, 'error');
      return false;
    }

    // 鼠标悬停触发菜单
    moreBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(0.3);

    // 点击"删除"选项（通常是菜单的第2个选项）
    const menuItems = document.querySelectorAll('.bili-cascader-options__item-custom');
    let deleteBtn = null;
    
    // 找到包含"删除"文字的菜单项
    for (const item of menuItems) {
      if (item.innerText.includes('删除')) {
        deleteBtn = item;
        break;
      }
    }

    // 如果没找到文字匹配的，用第二个选项（通常第一个是置顶/收藏，第二个是删除）
    if (!deleteBtn && menuItems.length >= 2) {
      deleteBtn = menuItems[1];
    }

    if (!deleteBtn) {
      log(`第 ${index} 条: 未找到删除按钮`, 'error');
      // 点击其他地方关闭菜单
      document.body.click();
      return false;
    }

    deleteBtn.click();
    await sleep(0.3);

    // 确认删除弹窗
    const confirmBtn = document.querySelector('.bili-modal__button.confirm.red') ||
                       document.querySelector('[class*="modal"] [class*="confirm"]');

    if (confirmBtn) {
      confirmBtn.click();
      await sleep(0.5);
      return true;
    } else {
      log(`第 ${index} 条: 未找到确认按钮`, 'error');
      return false;
    }
  }

  // ============ 主流程 ============
  try {
    log('🚀 开始执行...');
    log('📍 当前页面: ' + location.href);

    // 1. 滚动加载更多动态
    await scrollAndLoad(8);

    // 2. 获取所有动态
    const allItems = getDynamicItems();
    log(`📋 共获取 ${allItems.length} 条动态`);

    // 3. 筛选抽奖动态
    const lotteryItems = [];
    allItems.forEach((item, i) => {
      if (isLotteryItem(item)) {
        lotteryItems.push({ element: item, index: i });
      }
    });

    log(`🎯 筛选出 ${lotteryItems.length} 条抽奖动态`, 'warn');

    if (lotteryItems.length === 0) {
      log('✅ 没有找到抽奖动态', 'success');
      return;
    }

    // 4. 预览
    console.log('\n%c========== 待删除的抽奖动态 ==========', 'font-size: 14px; color: #ff6699;');
    lotteryItems.forEach((item, i) => {
      console.log(`%c${i + 1}. ${getPreviewText(item.element)}`, 'color: #333');
    });

    // 5. 如果只是预览，到此结束
    if (!CONFIG.autoDelete) {
      log('👆 以上是预览，未实际删除', 'warn');
      log('💡 确认无误后，将 CONFIG.autoDelete 改为 true 重新运行', 'warn');
      return;
    }

    // 6. 执行删除
    log('⚠️ 开始删除...', 'warn');
    let success = 0;
    let fail = 0;

    // 从后往前删，避免DOM变化影响索引
    for (let i = lotteryItems.length - 1; i >= 0; i--) {
      const item = lotteryItems[i];
      const preview = getPreviewText(item.element);

      // 可选：每条确认
      if (CONFIG.confirmEach) {
        if (!confirm(`删除这条动态？\n\n${preview}`)) {
          log(`跳过: ${preview}`, 'info');
          continue;
        }
      }

      log(`正在删除第 ${i + 1} 条: ${preview.substring(0, 30)}...`);
      
      // 滚动到该元素可见
      item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(0.5);

      const ok = await deleteDynamic(item.element, i + 1);
      if (ok) {
        success++;
        log(`✓ 已删除`, 'success');
      } else {
        fail++;
      }

      await sleep(CONFIG.delay);
    }

    log(`\n🎉 删除完成！成功 ${success} 条，失败 ${fail} 条`, 'success');

  } catch (err) {
    log(`❌ 执行出错: ${err.message}`, 'error');
    console.error(err);
  }
})();
