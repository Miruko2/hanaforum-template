# Requirements Document: Music Fisheye Canvas

## Introduction

`music-fisheye-canvas` 是 `/music` 路由下的沉浸式音乐发现页面，将多张可拖拽的音乐卡片以 Pinterest 风格交错列瀑布流铺满一个无限循环画布，并通过 3D 鱼眼透视形成穹顶/球面般的沉浸感。用户用鼠标或手指拖拽画布漫游，松手后画布以惯性继续滑行；点击任意卡片进入焦点态（液态玻璃质感的全屏遮罩 + 居中放大的卡片）；点击焦点态中的播放按钮即开始播放，并在视口角落生成一个常驻的迷你悬浮播放器，随后续拖拽与新焦点切换始终保持可见且唯一。

本功能将完全替换现有的 `app/music/page.tsx` 占位页（仅展示「音乐 / 即将上线」文案），把 `/music` 路由从一个静态占位升级为一个完整的可交互音乐发现界面。短期内默认使用本地静态歌单作为数据源，远端数据源（Supabase / 第三方音乐 API）通过抽象的数据访问层在后续阶段无侵入接入；UI 层与播放层不感知具体数据来源。

本文档约束的范围限定为：歌单浏览、画布拖拽与惯性、焦点态、播放与悬浮迷你播放器、设备能力分级降级、可访问性与性能体验。歌单的创建/上传/编辑、用户登录态、推荐算法、社区分享与评论、跨页面常驻播放器（贯穿整站路由）等不在本期范围内。

## Glossary

- **System / 音乐发现页面**：`/music` 路由下由 `music-fisheye-canvas` 实现的整体页面，包含画布、焦点遮罩、悬浮播放器三大可视区域。
- **画布（Canvas）**：填满视口的可拖拽容器，承载所有音乐卡片；拥有自己的世界坐标系与拖拽偏移。
- **音乐卡片（Music Card）**：画布中代表单首曲目的可视单元，展示封面、标题、艺术家、时长。
- **瀑布流（Masonry）**：等宽不等高的多列错落布局，每张卡片高度由曲目自身的纵横比或随机区间决定。
- **Tile**：一组完整瀑布流布局形成的矩形周期单元；画布在水平与垂直两个方向以 Tile 尺寸无限重复。
- **鱼眼焦点**：画布中作为透视消失点的位置，默认为视口中心；越靠近焦点的卡片越清晰、越大、越正面，越靠近边缘的卡片越压缩、越倾斜、越淡。
- **惯性（Inertia）**：用户松开拖拽后，画布以最近一段时间的平均速度继续滑行，并按摩擦系数衰减直至停止。
- **焦点态（Focus Mode）**：用户点击某张卡片后进入的全屏遮罩状态，被点击的卡片放大居中，画布其余部分以液态玻璃质感被模糊。
- **液态玻璃（Liquid Glass）**：焦点遮罩与悬浮播放器使用的视觉材质，呈现折射、模糊、轻微色散与饱和度增强的复合质感（用户视角的「玻璃感」，不绑定具体实现库）。
- **悬浮迷你播放器（Floating Player）**：固定于视口右下角、不随画布拖拽移动的小型播放器；显示当前曲目封面、标题、进度条、播放/暂停与关闭按钮。
- **音频驱动光晕**：悬浮播放器外圈随当前播放音频频谱实时脉动的发光与轻微缩放反馈。
- **主色（accentColor）**：每首曲目关联的主题色（来自数据自身或运行时由封面提色），用于卡片渐变描边、阴影与光晕的色相。
- **设备能力分级（Device Tier）**：在挂载阶段一次性探测出的设备能力档位，取值为 `high` / `mid` / `low`，用于驱动各装饰性效果的开关与帧率。所有 tier 相关的开关必须从单一来源读取，不允许各组件独立判断。
- **数据源（Track Data Source）**：歌曲数据的加载契约，默认实现为本地静态歌单，远端实现可通过相同契约无侵入替换。
- **同源或 https**：URL 满足 HTTPS 协议或与当前页面同源（同协议同主机同端口）的传输安全要求。

## Requirements

### Requirement 1：进入沉浸式音乐发现界面

**User Story:** 作为一名访问 `/music` 的访客，我希望进入页面后立刻看到一个沉浸式的 3D 鱼眼瀑布流音乐画布，以便我能直观感受到这是一个可探索的发现型空间，而不是一份静态列表。

#### Acceptance Criteria

1. WHEN 用户访问 `/music` 路由且歌单数据加载完成，THE System SHALL 渲染一个填满整个视口的全屏画布，并以 Pinterest 风格的多列错落瀑布流呈现所有音乐卡片。
2. WHEN 画布完成首次渲染，THE System SHALL 对每张可见卡片应用 3D 鱼眼透视变形，使越靠近视口中心的卡片越清晰、越大、越正面，越靠近视口边缘的卡片越压缩、越倾斜、并平滑淡出。
3. WHEN 视口尺寸变化，THE System SHALL 根据屏幕宽度自动调整列数与卡片尺寸，使画布在桌面、平板、手机三档屏幕下均保持瀑布流布局完整。
4. WHILE 歌单数据尚未加载完成，THE System SHALL 仅展示页面骨架而不渲染任何鱼眼变形或卡片，避免内容跳变。

### Requirement 2：拖拽漫游画布

**User Story:** 作为一名浏览者，我希望能够通过鼠标按住拖动或手指滑动来平移整个画布，以便像逛地图一样自由探索海量音乐卡片。

#### Acceptance Criteria

1. WHEN 用户在画布上按下鼠标左键并拖动，THE System SHALL 实时跟随指针位移更新画布偏移，使所有卡片整体跟随指针移动。
2. WHEN 用户在触摸设备上以单指按住并拖动画布，THE System SHALL 实时跟随触摸位移更新画布偏移，并阻止系统级手势（如下拉刷新、横向后退）干扰画布滑动。
3. WHILE 用户处于拖拽过程中，THE System SHALL 保持鼠标光标为「抓取中」状态，并在视觉上抑制卡片的悬停扫光效果以避免干扰。
4. IF 拖拽过程被系统打断（来电、应用切换或浏览器触发 PointerCancel），THEN THE System SHALL 将该事件等同于正常松手处理，并进入惯性滑行阶段。

### Requirement 3：松手后的惯性滑行

**User Story:** 作为一名浏览者，我希望在松开手指或鼠标后，画布能够顺势继续滑行一段距离再自然停下，以便我快速浏览较远区域时不需要反复拖动。

#### Acceptance Criteria

1. WHEN 用户结束拖拽（PointerUp 或 PointerCancel），THE System SHALL 基于松手前最近若干次指针位移采样，计算时间加权平均速度作为惯性初速度。
2. WHILE 画布处于惯性滑行中，THE System SHALL 按摩擦系数随时间归一化地衰减速度，使惯性速度大小随时间单调非增。
3. WHEN 惯性速度大小衰减至预设最小阈值之下，THE System SHALL 停止画布滑行并停止任何相关的逐帧更新循环。
4. WHEN 用户在惯性滑行期间再次按下并拖拽画布，THE System SHALL 立刻取消当前惯性滑行并接管为新的拖拽。

### Requirement 4：无限循环画布

**User Story:** 作为一名浏览者，我希望无论朝哪个方向拖动多远，画布永远不会出现尽头或空白，以便保持沉浸感。

#### Acceptance Criteria

1. THE System SHALL 在水平与垂直两个方向上以同一个 Tile 尺寸无限循环重复瀑布流布局，使画布在任何方向都不会出现可见边界。
2. WHEN 画布偏移在某一方向上累计移动了一个完整 Tile 的尺寸，THE System SHALL 输出与原偏移在该方向上等价的可见画面（即 Tile 周期性）。
3. THE System SHALL 在任意时刻仅渲染与视口加缓冲区域相交的卡片，剔除所有完全位于该区域之外的卡片。

### Requirement 5：桌面鼠标滚轮平滑滚动

**User Story:** 作为使用桌面浏览器的访客，我希望可以用鼠标滚轮丝滑地滚动画布，以便在不按住鼠标的情况下也能浏览。

#### Acceptance Criteria

1. WHERE 当前设备为桌面环境（无触摸输入）且设备能力档位不为 `low`，WHEN 用户在画布上滚动鼠标滚轮，THE System SHALL 将滚轮位移转译为画布偏移变化，并以带阻尼的平滑曲线过渡到目标偏移。
2. WHILE 鼠标滚轮平滑滚动正在进行，THE System SHALL 不与拖拽交互发生冲突，且不接管触摸事件。
3. WHERE 当前设备为触摸设备或设备能力档位为 `low`，THE System SHALL 不启用鼠标滚轮平滑滚动逻辑。
4. WHEN 设备能力档位在运行期由非 `low` 切换为 `low`（例如系统偏好动态切换为「减少动效」），THE System SHALL 允许当前已在进行中的滚轮平滑滚动自然衰减完成，并阻止任何后续新的滚轮平滑滚动启动。

### Requirement 6：聚焦单张卡片

**User Story:** 作为一名浏览者，我希望点击某张感兴趣的卡片后，它能放大并居中、其余画布被柔和模糊，以便我专注查看该曲目的详情。

#### Acceptance Criteria

1. WHEN 用户在非拖拽状态下点击任意一张可见的音乐卡片，THE System SHALL 进入焦点态：将该卡片以平滑动画放大并居中，同时以液态玻璃质感模糊画布其余部分。
2. WHILE 处于焦点态，THE System SHALL 仅保持当前焦点卡片清晰可见，画布中其余所有卡片由液态玻璃遮罩统一覆盖模糊。
3. WHEN 用户点击焦点遮罩的空白区域或点击焦点态上的关闭按钮，THE System SHALL 退出焦点态并以平滑动画把焦点卡片飞回原位。
4. WHEN 用户在焦点态下按下键盘 Esc 键，THE System SHALL 退出焦点态。
5. WHEN 焦点态退出，IF 当前已有曲目正在播放，THEN THE System SHALL 不暂停播放并保留悬浮迷你播放器在视口角落。

### Requirement 7：在焦点态启动播放

**User Story:** 作为一名浏览者，我希望在焦点态中点击播放按钮即可开始播放当前曲目，以便快速试听。

#### Acceptance Criteria

1. WHILE 处于焦点态，THE System SHALL 在焦点卡片上展示一个明显的播放/暂停按钮。
2. WHEN 用户点击焦点态上的播放按钮且当前未在播放该曲目，THE System SHALL 立即开始播放该曲目并把状态切换为「播放中」。
3. WHEN 用户点击焦点态上的暂停按钮且当前正在播放该曲目，THE System SHALL 暂停播放并保留进度。
4. WHEN 当前已有另一首曲目正在播放且用户点击焦点态的播放按钮播放新曲目，THE System SHALL 先停止旧曲目的播放并释放其资源，然后开始播放新曲目。
5. IF 音频加载失败（例如网络错误、CORS 错误或编解码错误），THEN THE System SHALL 在焦点态展示重试入口，并以提示信息告知用户「音频加载失败，请稍后再试」。

### Requirement 8：常驻悬浮迷你播放器

**User Story:** 作为一名听众，我希望开始播放后无论怎么拖动画布或切换焦点，都能在视口的固定位置看到一个迷你播放器，以便随时控制当前播放。

#### Acceptance Criteria

1. WHEN 一首曲目开始播放，THE System SHALL 在视口的固定位置（非画布世界坐标系）渲染一个悬浮迷你播放器。
2. WHILE 任意曲目处于播放或暂停状态，THE System SHALL 使悬浮迷你播放器始终可见，且不随画布拖拽、惯性滑行或滚轮滚动而移动。
3. THE System SHALL 在悬浮迷你播放器中展示当前曲目的封面、标题、当前播放进度、播放/暂停按钮与关闭按钮。
4. WHILE 曲目正在播放，THE System SHALL 使悬浮迷你播放器中的进度展示连续平滑地随播放时间向前推进。
5. WHEN 用户点击悬浮迷你播放器上的播放/暂停按钮，THE System SHALL 切换当前播放状态并同步更新焦点态（若仍处于焦点态）上的播放/暂停按钮。
6. WHEN 用户点击悬浮迷你播放器上的关闭按钮，THE System SHALL 停止播放并卸载悬浮迷你播放器。
7. THE System SHALL 在任意时刻最多渲染一个悬浮迷你播放器；当一首新曲目开始播放时，旧的悬浮迷你播放器内容必须被新曲目内容覆盖而不会出现两个并存。

### Requirement 9：音频驱动的光晕反馈

**User Story:** 作为一名听众，我希望悬浮迷你播放器能随音乐节奏产生轻微的发光脉动，以便从余光也能感受到「正在响起」的存在感。

#### Acceptance Criteria

1. WHILE 一首曲目正在播放，THE System SHALL 实时分析当前音频的频谱并将其分为低频、中频、高频三段强度，每一段强度归一化在 0 到 1 之间。
2. WHILE 一首曲目正在播放，THE System SHALL 使用频谱强度驱动悬浮迷你播放器外圈的光晕半径、不透明度与轻微缩放变化，使之形成与音乐节奏相符的脉动反馈。
3. THE System SHALL 使光晕的视觉色相沿用当前曲目的主色。
4. WHILE 曲目处于暂停或停止状态，THE System SHALL 关闭光晕脉动并保持悬浮迷你播放器静态展示，不残留逐帧更新循环。
5. IF 浏览器尚未授权创建音频上下文（例如未发生过用户手势），THEN THE System SHALL 退化为静态光晕展示而不影响播放本身。

### Requirement 10：精致的卡片视觉

**User Story:** 作为一名追求美感的访客，我希望每张音乐卡片本身就是一件视觉作品，以便整个画布看起来像一面会呼吸的音乐墙。

#### Acceptance Criteria

1. THE System SHALL 在每张卡片上展示曲目封面图、标题与艺术家信息，并对图片资源使用模糊占位以避免白色闪烁。
2. THE System SHALL 在每张卡片外圈渲染一条以当前曲目主色为起点的渐变描边，并基于主色生成柔和阴影。
3. WHERE 设备能力档位不为 `low`，THE System SHALL 在卡片之上叠加一层颗粒纹理以形成轻微的胶片质感。
4. WHERE 设备能力档位不为 `low` 且画布未处于拖拽状态，WHEN 用户的指针悬浮在某张卡片上，THE System SHALL 在该卡片表面播放一次柔和的横向扫光动画。
5. WHILE 画布处于拖拽或惯性滑行状态，THE System SHALL 抑制卡片的悬浮扫光动画。

### Requirement 11：可扩展的数据来源

**User Story:** 作为产品迭代者，我希望本期实现使用本地静态歌单，但数据访问层是抽象的，以便未来切换到 Supabase 或第三方音乐 API 时不必改动 UI 与播放层。

#### Acceptance Criteria

1. THE System SHALL 默认从本地静态歌单加载曲目数据并完成首屏渲染，不依赖任何远端调用。
2. THE System SHALL 通过统一的歌曲数据访问契约（含「列出全部曲目」与「按 ID 获取单首曲目」两类操作）向 UI 层提供数据。
3. WHEN 数据访问的具体实现被替换为远端实现且其满足相同的契约，THE System SHALL 在不修改任何 UI 组件与播放逻辑的前提下继续正常运作。
4. THE System SHALL 在曲目数据中至少包含曲目唯一标识、标题、艺术家、封面 URL、音频 URL 与时长。
5. IF 歌单加载失败，THEN THE System SHALL 展示一个空态页面并提供重试入口，而不是渲染半成品的画布。

## Non-Functional Requirements

### Requirement NFR-1：响应式与设备能力分级

**User Story:** 作为不同设备的用户，我希望页面在桌面、平板、手机以及不同性能档位的设备上都能流畅自洽地运行，以便我无需关心硬件差异。

#### Acceptance Criteria

1. WHEN 视口宽度变化，THE System SHALL 重新计算列数与卡片尺寸，使瀑布流布局在桌面、平板、手机三档屏幕下均无横向滚动条且不出现卡片裁切错位。
2. WHEN 页面挂载，THE System SHALL 一次性探测当前设备能力并将其归类为 `high` / `mid` / `low` 之一作为整页装饰效果的单一来源。
3. THE System SHALL 在设备能力档位上保持单调降级：任何装饰性效果在 `mid` 档位下的开启程度不得高于 `high`，在 `low` 档位下不得高于 `mid`。
4. WHEN 用户系统偏好为「减少动效」（prefers-reduced-motion: reduce），THE System SHALL 直接将设备能力档位置为 `low`。
5. THE System SHALL 让所有依赖设备能力档位的装饰组件从同一来源读取档位，确保任意时刻不出现「高档关、低档开」的错配。
6. *（对应 Correctness Property 10：性能分级单调降级）*

### Requirement NFR-2：可见 mesh / draw call 数量有界

**User Story:** 作为关心性能的工程师，我希望无论用户拖拽多久，渲染所需的 mesh 与 draw call 数量都不会无限增长，以便长会话不会耗尽 GPU 内存或拖慢帧率。

#### Acceptance Criteria

1. THE System SHALL 在任意时刻仅渲染单个曲面 mesh 用于所有卡片，通过纹理图集（texture atlas）承载所有可见卡片内容，避免随会话时长出现 mesh 数量增长。
2. THE System SHALL 使主场景的 draw call 数量存在仅依赖装饰层（如后处理通道、焦点 DOM 层）的固定上界，不依赖累计拖拽距离或会话时长。
3. WHILE 用户持续拖拽超过单个 Tile 尺寸，THE System SHALL 仅更新 mesh 的纹理 UV 偏移或 camera offset，不发生 mesh / material / geometry 的销毁与重建。
4. *（对应 Correctness Property 5：可见 mesh / draw call 数量有界）*

### Requirement NFR-3：拖拽可逆性

**User Story:** 作为用户，我希望我把画布往一个方向拖出去后再拖回等量距离，画面能精确回到原位，以便交互手感稳定可预期。

#### Acceptance Criteria

1. WHEN 用户先施加位移 d 再施加位移 −d 后松手停止，THE System SHALL 使画布偏移回到操作前的原值（数值容差不超过 1 像素）。
2. *（对应 Correctness Property 1：拖拽可逆性）*

### Requirement NFR-4：惯性收敛性

**User Story:** 作为用户，我希望松手后画布的滑行不会越甩越远或永不停止，以便交互可控。

#### Acceptance Criteria

1. WHILE 处于惯性滑行阶段且未发生新的拖拽输入，THE System SHALL 使画布滑行速度的大小随时间单调非增。
2. WHEN 用户结束拖拽，THE System SHALL 在有限时间内使惯性速度衰减至零并停止任何相关的逐帧更新循环。
3. *（对应 Correctness Property 8：惯性速度单调衰减）*

### Requirement NFR-5：鱼眼变换的数值稳定与对称

**User Story:** 作为用户，我希望鱼眼效果在任何画布偏移与卡片位置下都不会出现错乱、闪烁或变成空白的卡片，以便视觉始终连贯。

#### Acceptance Criteria

1. THE System SHALL 对任何处于合理范围内的卡片中心位置，输出有限的鱼眼变换数值（不出现 NaN 或 Infinity）以及在 0 到 1 之间的卡片不透明度。
2. WHEN 卡片位于视口中心，THE System SHALL 对该卡片不应用任何位移、旋转或缩放（即中心恒等）。
3. THE System SHALL 使鱼眼变换关于视口中心左右镜像对称：相对于视口中心水平方向距离相同的两张卡片，其缩放与不透明度必须相等。
4. *（对应 Correctness Property 2：鱼眼变换有限性 与 Correctness Property 3：鱼眼镜像对称）*

### Requirement NFR-6：Tile 周期性

**User Story:** 作为用户，我希望画布的循环重复在视觉上无缝衔接，以便看不出画布在「翻页」。

#### Acceptance Criteria

1. THE System SHALL 让画布偏移在水平方向移动一个 Tile 宽度后所呈现的可见画面，与原始偏移所呈现的画面在视口坐标系中等价。
2. THE System SHALL 让画布偏移在垂直方向移动一个 Tile 高度后所呈现的可见画面，与原始偏移所呈现的画面在视口坐标系中等价。
3. *（对应 Correctness Property 4：Tile 周期性）*

### Requirement NFR-7：焦点排他性

**User Story:** 作为用户，我希望进入焦点态后只有焦点卡片清晰，画布其余部分一致地被模糊；退出焦点态后所有卡片同步恢复清晰，以便不出现「半模糊半清晰」的中间态。

#### Acceptance Criteria

1. WHILE 处于焦点态，THE System SHALL 仅保持当前焦点卡片清晰可见，所有其它可见卡片必须被同一遮罩统一模糊。
2. WHEN 焦点态退出，THE System SHALL 在同一渲染周期内恢复所有可见卡片的清晰度，不出现部分卡片仍被模糊的中间状态。
3. *（对应 Correctness Property 7：焦点排他性）*

### Requirement NFR-8：悬浮迷你播放器唯一性

**User Story:** 作为用户，我希望任意时刻视口里最多只有一个迷你播放器，以便界面不被多个播放器塞满。

#### Acceptance Criteria

1. THE System SHALL 在任意时刻最多渲染一个悬浮迷你播放器实例。
2. WHEN 一首新曲目开始播放，THE System SHALL 用新曲目的内容覆盖原有的悬浮迷你播放器，而不是新增一个。
3. *（对应 Correctness Property 6：至多一张悬浮播放卡片）*

### Requirement NFR-9：音频反馈有界与平滑

**User Story:** 作为用户，我希望悬浮播放器随音乐脉动的反馈是细腻平滑的，而不是刺眼的剧烈跳动，以便观感舒适。

#### Acceptance Criteria

1. THE System SHALL 始终把驱动光晕的低频、中频、高频三段强度限制在 0 到 1 之间。
2. WHILE 一首曲目正在播放，THE System SHALL 使任意一段频谱强度在相邻两次更新（不超过一帧时间，约 16.7 毫秒）之间的变化幅度不超过 0.5。
3. *（对应 Correctness Property 9：音频反馈有界与平滑）*

### Requirement NFR-10：错误处理

**User Story:** 作为用户，我希望在任何环节出错时页面都给我一个清晰的反馈与重试机会，而不是白屏或崩溃，以便我能继续完成想做的事。

#### Acceptance Criteria

1. IF 音频加载失败（包含网络错误、CORS 错误、编解码错误），THEN THE System SHALL 把当前播放状态切换为「错误」，展示重试入口与文字提示而不抛出未捕获异常。
2. IF 歌单数据加载失败，THEN THE System SHALL 展示空态并提供重试按钮，不渲染半成品画布。
3. IF 视口尺寸为 0（例如首次挂载或容器隐藏），THEN THE System SHALL 仅渲染容器骨架而不计算瀑布流与鱼眼，并在视口尺寸恢复非零后自动重新渲染。
4. IF 调用方传入了非法的鱼眼参数（例如负的最小缩放），THEN THE System SHALL 回退为默认参数继续运行，不出现异常或崩溃。
5. WHEN 拖拽过程被系统打断（PointerCancel 或 PointerLeave），THE System SHALL 把该事件等同于正常松手处理。

### Requirement NFR-11：Capacitor Android 兼容

**User Story:** 作为安卓 App 用户，我希望在打包成 Capacitor 的 WebView 中也能顺畅地以触摸滑动浏览画布，以便移动端体验与 Web 端一致。

#### Acceptance Criteria

1. WHEN 页面在 Capacitor Android WebView 中加载，THE System SHALL 通过禁用系统级触摸手势（CSS `touch-action: none`）来保证画布可以连续接收手指滑动事件而不被原生手势打断。
2. WHILE 用户在 Capacitor Android WebView 中滑动画布，THE System SHALL 保持惯性滑行与无限循环行为与桌面浏览器一致。

### Requirement NFR-12：可访问性

**User Story:** 作为对动效敏感或依赖辅助技术的用户，我希望页面能够尊重我的偏好并保留必要的语义信息，以便我也能舒适地使用它。

#### Acceptance Criteria

1. WHEN 用户系统偏好为「减少动效」，THE System SHALL 关闭所有非必要的装饰性动画（包含鱼眼边缘的抖动、卡片扫光、音频驱动光晕、滚轮平滑等）。
2. THE System SHALL 为每张卡片的封面图提供文本替代描述（包含曲目标题与艺术家），并为播放、暂停、关闭等控制按钮提供可读的可访问名称。
3. WHEN 用户在焦点态下按下键盘 Esc 键，THE System SHALL 退出焦点态。

### Requirement NFR-13：包体积约束

**User Story:** 作为关注首屏性能的工程师，我希望 WebGL 依赖被严格隔离在 `/music` 路由内，不影响其他路由首屏，以便首页与主流程加载速度不退化。

#### Acceptance Criteria

1. THE System SHALL 通过动态 import (`next/dynamic` 或 `React.lazy`) 将 three / @react-three/fiber / @react-three/drei / animejs 隔离在 `/music` 路由的客户端 chunk 内。
2. THE System SHALL 使 `/music` 路由首屏（initial client JS）gzip 后总和不超过 250 KB。
3. THE System SHALL 不在 `/music` 之外的任何路由的客户端 chunk 中包含 three / R3F / drei / animejs 中的任何模块。

### Requirement NFR-14：资源安全

**User Story:** 作为安全负责人，我希望页面引用的所有音频与封面资源都是受信通道传输的，以便规避 XSS 与混合内容风险。

#### Acceptance Criteria

1. THE System SHALL 使每首曲目的封面 URL 满足 HTTPS 协议或与当前页面同源。
2. THE System SHALL 使每首曲目的音频 URL 满足 HTTPS 协议或与当前页面同源。
3. IF 某条曲目的封面或音频 URL 不满足上述安全要求，THEN THE System SHALL 拒绝在画布或播放器中加载该曲目对应的资源。

## Out of Scope

以下事项明确不在本期 `music-fisheye-canvas` 的范围内：

- 用户登录态、账户体系与个性化推荐算法。
- 歌单的创建、上传、编辑、删除与持久化（包含音频文件与封面图的上传）。
- 歌曲的收藏、点赞、评论、分享、社区互动、播放历史与统计。
- 跨页面常驻播放器：本期的悬浮迷你播放器仅在 `/music` 路由可见，离开该路由后不要求继续播放。
- 歌词同步显示、播放队列管理（上一首 / 下一首 / 顺序与随机）、音量与音质切换。
- 远端数据源（Supabase / 第三方音乐 API）的具体接入实现：本期仅保留可扩展的数据访问契约。
- 服务端推送、实时房间、跨用户协同等带有后端通讯的能力。

## Dependencies and Assumptions

### Dependencies

- 复用项目已有的 Next.js 路由、React 18+ 与 TypeScript 工具链。
- 复用项目已有的 Tailwind 样式体系、图标库与图片优化组件。
- 数据访问层短期内依赖项目仓库中维护的本地静态歌单常量。
- 在 Capacitor Android 打包目标下，依赖 Capacitor 提供的 WebView 容器与现有的页面壳。

### Assumptions

- 用户在进入 `/music` 路由后会先与页面发生至少一次手势交互（拖拽或点击播放按钮），从而满足浏览器对音频上下文创建必须发生在用户手势内的要求。
- 设备的视口尺寸最终会进入非零状态；首屏渲染允许出现极短暂的 0 视口阶段，由 ResizeObserver 在尺寸到位后驱动重新渲染。
- 现有 `app/music/page.tsx` 占位页将被本功能完全替换为完整实现，原有「即将上线」的占位内容不再保留。
- 本功能假设页面运行环境支持 PointerEvents、ResizeObserver、requestAnimationFrame，以及（在桌面与 mid 档及以上的设备上）Web Audio API；在不支持 Web Audio 的环境下音频驱动光晕将退化为静态展示而播放本身仍可工作。
