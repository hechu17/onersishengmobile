const W = 390;
const H = 844;
const HORIZON = 86;
const ROAD_LEFT = 42;
const ROAD_WIDTH = 306;
const LANE_WIDTH = ROAD_WIDTH / 3;
const PLAYER_Y = 724;
const VIEW_DISTANCE = 930;
const TOTAL_DISTANCE = 8300;
const INTRO_SAFE_DISTANCE = 1000;
const YOUGAN_TRIPLE_GAME_TIME = 45;
const SAFE_WAVE_GAP = 270;
const PLAYER_HITBOX_HALF_WIDTH = 32;
const OBSTACLE_HITBOX_HALF_WIDTH = 26;
const PICKUP_LANE_RADIUS = 0.58;
const COLLISION_ZONE_TOP = PLAYER_Y - 64;
const COLLISION_ZONE_BOTTOM = PLAYER_Y + 24;
const OBJECT_DESPAWN_Z = -130;
const YOUGAN_SPEED_MULTIPLIER = 1.2;

// Pressure can rise faster now, but the relief-item cadence is calculated from
// the same wave frequency so a clean run does not fail just because the random
// roll missed every Maimai pickup.
const PRESSURE_BALANCE = {
  naturalRateStart: 0.68,
  naturalRateGrowth: 1.16,
  pickupChanceStart: 0.14,
  pickupChanceGrowth: 0.05,
  maimaiWeight: 2,
  maimaiSafetyDistance: INTRO_SAFE_DISTANCE + 360,
  maimaiSafetyRatio: 0.78,
  maimaiSafetyGapMin: 11,
  maimaiSafetyGapMax: 20,
};

const SPEED_BALANCE = {
  start: 238,
  end: 360,
};

const ASSETS = {
  player: "./assets/images/vehicle_player_neon_coupe.png",
  chaser: "./assets/images/vehicle_chaser_tail_red.png",
  obstacles: [
    { file: "./assets/images/obstacle_news_van.png", label: "新闻车" },
    { file: "./assets/images/obstacle_service_cart.png", label: "地勤车" },
    { file: "./assets/images/obstacle_crowd_barrier.png", label: "人群护栏" },
    { file: "./assets/images/obstacle_cone_line.png", label: "路障" },
    { file: "./assets/images/obstacle_planter.png", label: "花盆" },
    { file: "./assets/images/obstacle_luggage_cart.png", label: "行李车" },
    { file: "./assets/images/obstacle_garage_column.png", label: "车库柱" },
  ],
  yougan: "./assets/images/item_yougan.png",
  bunnyGrenade: "./assets/images/item_bunny_grenade.png",
  maimai: "./assets/images/item_maimai_relief.png",
};

const PRELOAD_ASSETS = [
  "./assets/images/ending_bunny_closed_bar_v1.png",
  "./assets/images/ending_crab_claw_v1.png",
  "./assets/images/ending_taxi_didi_fans_v1.png",
  "./assets/images/ending_pressure_fight_v1.png",
  "./assets/images/ending_timeout_late_backstage_v1.png",
  "./assets/images/ending_success_escaped_wrecked_fans_v1.png",
];

const PICKUP_STYLES = {
  yougan: { file: ASSETS.yougan, label: "油柑", color: "#ff8fb3" },
  bunnyGrenade: { file: ASSETS.bunnyGrenade, label: "小兔手雷", color: "#9f7bff" },
  maimai: { file: ASSETS.maimai, label: "麦麦", color: "#57d9ff" },
};
const PICKUP_TYPES = [
  { type: "bunnyGrenade", weight: 5 },
  { type: "maimai", weight: PRESSURE_BALANCE.maimaiWeight },
  { type: "yougan", weight: 1 },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const weightedPickupType = () => {
  const totalWeight = PICKUP_TYPES.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of PICKUP_TYPES) {
    roll -= item.weight;
    if (roll < 0) return item.type;
  }
  return PICKUP_TYPES[PICKUP_TYPES.length - 1].type;
};

class MobileChaseGame {
  constructor() {
    this.canvas = document.querySelector("#game");
    this.ctx = this.canvas.getContext("2d");
    this.screen = document.querySelector("#screen");
    this.hud = document.querySelector("#hud");
    this.controls = document.querySelector("#controls");
    this.flash = document.querySelector("#flash");
    this.toast = document.querySelector("#toast");
    this.countdown = document.querySelector("#countdown");
    this.pauseButton = document.querySelector("#pause-button");
    this.muteButton = document.querySelector("#mute-button");
    this.distanceFill = document.querySelector("#distance-fill");
    this.healthFill = document.querySelector("#health-fill");
    this.healthLabel = document.querySelector("#health-label");
    this.images = new Map();
    this.state = "loading";
    this.introPage = 1;
    this.assetsReady = false;
    this.loadingRequest = null;
    this.loadingProgress = { loaded: 0, total: 0 };
    this.loadingFailed = [];
    this.muted = false;
    this.lastTime = performance.now();
    this.toastTimer = 0;
    this.pointerStart = null;
    this.audio = this.createAudio();
    this.showLoading();
    this.preloadAssets();
    this.bindEvents();
    this.resize();
    this.resetRun();
    window.__mobileGameDebug = () => ({
      state: this.state,
      lane: this.lane,
      distance: Math.round(this.distance),
      danger: Math.round(this.danger),
      health: this.health,
      obstacles: this.obstacles.length,
      maimaiSpawned: this.maimaiSpawned,
      pickupCounts: { ...this.pickupCounts },
    });
    requestAnimationFrame((time) => this.frame(time));
  }

  createAudio() {
    if (typeof Audio === "undefined") return null;
    const audio = new Audio("./assets/audio/bgm.mp3");
    audio.loop = true;
    audio.volume = 0.24;
    audio.preload = "auto";
    return audio;
  }

  getPreloadPaths() {
    return [...new Set([
      ASSETS.player,
      ASSETS.chaser,
      ...Object.values(PICKUP_STYLES).map((item) => item.file),
      ...ASSETS.obstacles.map((item) => item.file),
      ...PRELOAD_ASSETS,
    ])];
  }

  preloadImage(path) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve({ path, ok });
      };
      image.addEventListener("load", () => finish(true), { once: true });
      image.addEventListener("error", () => finish(false), { once: true });
      image.src = path;
      this.images.set(path, image);
      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  preloadAudio() {
    if (!this.audio) return Promise.resolve({ path: "BGM", ok: true });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        this.audio.removeEventListener("loadeddata", onReady);
        this.audio.removeEventListener("canplaythrough", onReady);
        this.audio.removeEventListener("error", onError);
        resolve({ path: "BGM", ok });
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      this.audio.addEventListener("loadeddata", onReady, { once: true });
      this.audio.addEventListener("canplaythrough", onReady, { once: true });
      this.audio.addEventListener("error", onError, { once: true });
      try {
        this.audio.load();
      } catch {
        finish(false);
        return;
      }
      if (this.audio.readyState >= 2) finish(true);
      window.setTimeout(() => finish(this.audio.readyState >= 2), 5000);
    });
  }

  updateLoadingProgress(loaded, total) {
    this.loadingProgress = { loaded, total };
    const percent = total ? Math.round((loaded / total) * 100) : 100;
    const fill = this.screen.querySelector("#loading-fill");
    const label = this.screen.querySelector("#loading-label");
    const value = this.screen.querySelector("#loading-percent");
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = `正在加载资源 ${loaded} / ${total}`;
    if (value) value.textContent = `${percent}%`;
  }

  showLoading() {
    this.state = "loading";
    this.hud.classList.add("hidden");
    this.controls.classList.add("hidden");
    this.screen.classList.remove("hidden");
    this.screen.innerHTML = `
      <div class="panel loading-panel" role="status" aria-live="polite">
        <div class="loading-mark"><span></span><i></i><span></span></div>
        <p class="eyebrow">INITIALIZING NIGHT RUN</p>
        <h1>正在准备逃离路线</h1>
        <p class="loading-copy">正在加载车辆、障碍、道具和结算画面，稍等片刻即可开始。</p>
        <div class="loading-progress">
          <div class="loading-progress-head"><span id="loading-label">正在加载资源</span><b id="loading-percent">0%</b></div>
          <div class="loading-track"><i id="loading-fill"></i></div>
        </div>
        <p class="loading-tip">请不要在资源加载完成前开始游戏。</p>
      </div>
    `;
    this.updateLoadingProgress(this.loadingProgress.loaded, this.loadingProgress.total);
  }

  showLoadingError() {
    this.state = "loading-error";
    this.screen.innerHTML = `
      <div class="panel loading-panel loading-error-panel" role="alert" aria-live="assertive">
        <div class="loading-mark loading-mark-error"><span>!</span></div>
        <p class="eyebrow">LOAD FAILED</p>
        <h1>资源加载失败</h1>
        <p class="loading-copy">部分贴图或 BGM 没有加载完成，请检查服务器后重新尝试。</p>
        <button class="primary-button" data-action="retry-loading" type="button">重新加载 <span>↻</span></button>
      </div>
    `;
  }

  async preloadAssets() {
    if (this.loadingRequest) return this.loadingRequest;
    this.assetsReady = false;
    this.loadingFailed = [];
    this.showLoading();
    const paths = this.getPreloadPaths();
    const total = paths.length + (this.audio ? 1 : 0);
    let loaded = 0;
    this.updateLoadingProgress(0, total);
    const markComplete = (result) => {
      loaded += 1;
      this.updateLoadingProgress(loaded, total);
      return result;
    };
    const tasks = paths.map((path) => this.preloadImage(path).then(markComplete));
    if (this.audio) tasks.push(this.preloadAudio().then(markComplete));
    this.loadingRequest = Promise.all(tasks).then((results) => {
      this.loadingRequest = null;
      this.loadingFailed = results.filter((result) => !result.ok).map((result) => result.path);
      if (this.loadingFailed.length) {
        this.showLoadingError();
        return false;
      }
      this.assetsReady = true;
      this.showHome();
      return true;
    });
    return this.loadingRequest;
  }

  bindEvents() {
    this.screen.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "start" || action === "restart") this.startRun();
      if (action === "retry-loading") this.preloadAssets();
      if (action === "intro-next") this.renderHomePage(this.introPage + 1);
      if (action === "intro-prev") this.renderHomePage(this.introPage - 1);
    });
    this.pauseButton.addEventListener("click", () => this.togglePause());
    this.muteButton.addEventListener("click", () => this.toggleMute());

    document.querySelector("#left-button").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.switchLane(-1);
    });
    document.querySelector("#right-button").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.switchLane(1);
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      const rect = this.canvas.getBoundingClientRect();
      const logicalX = ((event.clientX - rect.left) / rect.width) * W;
      this.pointerStart = null;
      if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) this.switchLane(dx > 0 ? 1 : -1);
      else if (this.state === "playing") this.switchLane(logicalX > W / 2 ? 1 : -1);
    });

    window.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "a", "d", "A", "D", "Enter", "p", "P", "m", "M"].includes(event.key)) event.preventDefault();
      if (event.repeat) return;
      if (event.key === "Enter" && this.state === "loading-error") this.preloadAssets();
      if (event.key === "Enter" && this.state === "home") {
        if (this.introPage < 3) this.renderHomePage(this.introPage + 1);
        else this.startRun();
      }
      if (event.key === "Enter" && this.state === "result") this.startRun();
      if (event.key === "p" || event.key === "P") this.togglePause();
      if (event.key === "m" || event.key === "M") this.toggleMute();
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") this.switchLane(-1);
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") this.switchLane(1);
    });
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resetRun() {
    this.lane = 1;
    this.visualLane = 1;
    this.distance = 0;
    this.danger = 16;
    this.health = 3;
    this.speed = SPEED_BALANCE.start;
    this.roadTravel = 0;
    this.safeLane = 1;
    this.elapsed = 0;
    this.spawnTimer = 1.05;
    this.countdownTimer = 0;
    this.invincibilityTimer = 0;
    this.slowTimer = 0;
    this.flashTimer = 0;
    this.obstacles = [];
    this.pickups = [];
    this.particles = [];
    this.pausedState = null;
    this.lastWaveWasPair = false;
    this.lastMaimaiSpawnElapsed = -Infinity;
    this.maimaiSpawned = 0;
    this.pickupCounts = {
      bunnyGrenade: 0,
      yougan: 0,
      maimai: 0,
    };
    this.youganTripleSpawned = false;
  }

  showHome() {
    this.state = "home";
    this.introPage = 1;
    this.hud.classList.add("hidden");
    this.controls.classList.add("hidden");
    this.screen.classList.remove("hidden");
    this.renderHomePage(this.introPage);
  }

  renderHomePage(page) {
    this.introPage = clamp(page, 1, 3);
    const pageContent = {
      1: `
        <div class="intro-page">
          <div>
            <span class="briefing-label">紧急情况 // 追车警报</span>
            <h2>发现私生车辆！</h2>
          </div>
          <p class="intro-page-copy">可恶！刚驶入复杂路段，就被私生追上了，躲开障碍、甩开它们！</p>
          <div class="mission-goal"><span>千万小心</span><strong>撞车过多，或追车压力达到 100%，游戏失败</strong></div>
          <p class="briefing-tip">别担心，我们有一些妙妙工具</p>
        </div>
        <div class="intro-actions intro-actions-single">
          <button class="secondary-button" data-action="intro-next" type="button">下一页 <span>→</span></button>
        </div>
      `,
      2: `
        <div class="intro-page">
          <div>
            <span class="briefing-label">妙妙工具 // 拾取即生效</span>
            <h2>路上随机散落三种道具</h2>
          </div>
          <div class="briefing-items briefing-items-stacked">
            <div class="briefing-item briefing-item-grenade">
              <img src="${PICKUP_STYLES.bunnyGrenade.file}" alt="小兔手雷图标" />
              <div class="briefing-item-copy"><b>小兔手雷</b><small>清除当前车道上最近的障碍。</small></div>
            </div>
            <div class="briefing-item briefing-item-yougan">
              <img src="${PICKUP_STYLES.yougan.file}" alt="油柑图标" />
              <div class="briefing-item-copy"><b>柑就完了</b><small>拾取后无敌 8 秒，可以安全穿过障碍。</small></div>
            </div>
            <div class="briefing-item briefing-item-maimai">
              <img src="${PICKUP_STYLES.maimai.file}" alt="麦麦图标" />
              <div class="briefing-item-copy"><b>来口麦麦</b><small>拾取后降低 26 点追车压力，碳水使人善良。</small></div>
            </div>
          </div>
        </div>
        <div class="intro-actions">
          <button class="secondary-button" data-action="intro-prev" type="button"><span>←</span> 上一页</button>
          <button class="secondary-button" data-action="intro-next" type="button">下一页 <span>→</span></button>
        </div>
      `,
      3: `
        <div class="intro-page">
          <div>
            <span class="briefing-label">操作指南 // 保持移动</span>
            <h2>左右换道，冲到安全点</h2>
          </div>
          <div class="control-list">
            <div><b>触控</b><span>点击左右箭头，或在画面上左右滑动换道。</span></div>
            <div><b>键盘</b><span>使用 ← → 或 A / D 换道。</span></div>
            <div><b>游戏控制</b><span>P 暂停 · M 静音。</span></div>
          </div>
          <p class="briefing-tip">障碍和速度会逐渐增加。祝你顺利甩开追车，安全抵达目的地。</p>
        </div>
        <div class="intro-actions">
          <button class="secondary-button" data-action="intro-prev" type="button"><span>←</span> 上一页</button>
          <button class="primary-button" data-action="start" type="button">开始突围 <span>→</span></button>
        </div>
      `,
    }[this.introPage];

    this.screen.innerHTML = `
      <div class="panel home-panel intro-home-panel">
        <div class="intro-topbar"><div class="brand-mark"><span>SR</span><i></i><em>02</em></div><span class="signal-badge"><i></i> NIGHT RUN</span></div>
        <p class="eyebrow">任务简报 · ${String(this.introPage).padStart(2, "0")} / 03</p>
        <div class="briefing-progress" aria-label="任务简报进度">
          <i class="${this.introPage >= 1 ? "is-active" : ""}"></i>
          <i class="${this.introPage >= 2 ? "is-active" : ""}"></i>
          <i class="${this.introPage >= 3 ? "is-active" : ""}"></i>
          <span>BRIEFING ${String(this.introPage).padStart(2, "0")}</span>
        </div>
        ${this.introPage === 1 ? '<h1>私生滚开<br /><span>夜路突围</span></h1>' : ""}
        ${pageContent}
      </div>
    `;
  }

  startRun() {
    if (!this.assetsReady) return;
    this.resetRun();
    this.state = "countdown";
    this.countdownTimer = 3.1;
    this.screen.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.controls.classList.remove("hidden");
    this.updatePauseButton();
    this.showToast(`目标：跑完 ${TOTAL_DISTANCE}m，抵达安全点`, 2.4);
    if (this.audio) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    }
  }

  togglePause() {
    if (this.state === "paused") {
      this.state = this.pausedState || "playing";
      this.pausedState = null;
      this.updatePauseButton();
      this.showToast("游戏继续", 0.9);
      this.audio?.play().catch(() => {});
      return;
    }
    if (this.state !== "playing" && this.state !== "countdown") return;
    this.pausedState = this.state;
    this.state = "paused";
    this.updatePauseButton();
    this.showToast("游戏已暂停", 1.2);
    this.audio?.pause();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.audio) this.audio.muted = this.muted;
    this.updateMuteButton();
  }

  getMostCollectedPickup() {
    const [type, count] = Object.entries(this.pickupCounts)
      .sort((first, second) => second[1] - first[1])[0] || [];
    if (!count) return { label: "暂无道具", count: 0 };
    return { label: PICKUP_STYLES[type]?.label || type, count };
  }

  getFailureScene(reason) {
    const genericResults = [
      {
        image: "./assets/images/ending_bunny_closed_bar_v1.png",
        alt: "深夜关门酒吧前失落的小兔子",
        mainCaption: "酒吧关门了",
        subCaption: "满心期待的喝酒夜被毁掉了，健康，但是可怜",
      },
      {
        image: "./assets/images/ending_crab_claw_v1.png",
        alt: "青色蟹钳从天而降夹走玩家车辆，气泡中的奶牛猫十分害怕",
        mainCaption: "车被螃蟹夹走了",
        subCaption: "洋洋惊恐中，不知道“螃蟹”和“车被螃蟹夹走”哪个更可怕",
      },
      {
        image: "./assets/images/ending_taxi_didi_fans_v1.png",
        alt: "DIDI出租车载着得意的比格犬离开，后方是失落的私生粉",
        mainCaption: "DIDI打着DIDI离开",
        subCaption: "车都没了，驾照有什么用",
      },
    ];
    const pressureResults = [
      {
        image: "./assets/images/ending_pressure_fight_v1.png",
        alt: "比格犬下车准备冲向私生粉，奶牛猫拦住它，兔子打电话报警",
        mainCaption: "过来我给你手机摔了",
        subCaption: "别冲动，别给人打爽了，老岳快报警",
      },
    ];
    const timeoutResults = [
      {
        image: "./assets/images/ending_timeout_late_backstage_v1.png",
        alt: "后台工作人员训话，迟到的兔子、奶牛猫和比格犬低头道歉",
        mainCaption: "活动迟到了",
        subCaption: "结果如此，原因对于此刻并不重要",
      },
    ];
    const availableResults = reason === "追车压力爆表，信号已经暴露"
      ? [...genericResults, ...pressureResults]
      : reason === "撤离时间耗尽"
        ? [...genericResults, ...timeoutResults]
        : genericResults;
    return availableResults[Math.floor(Math.random() * availableResults.length)];
  }

  finish(won, reason) {
    if (this.state !== "playing" && this.state !== "countdown") return;
    this.state = "result";
    this.flash.classList.remove("active");
    this.hud.classList.add("hidden");
    this.controls.classList.add("hidden");
    this.countdown.textContent = "";
    const distance = Math.min(TOTAL_DISTANCE, Math.round(this.distance));
    const mostCollectedPickup = this.getMostCollectedPickup();
    const resultScene = won
      ? {
        image: "./assets/images/ending_success_escaped_wrecked_fans_v1.png",
        alt: "三只小动物在车里得意庆祝，远处的私生车辆已经报废并被甩开",
        mainCaption: "成功甩开私生车",
        subCaption: "距离产生美，对双方都一样",
      }
      : this.getFailureScene(reason);
    this.screen.classList.remove("hidden");
    this.screen.innerHTML = `
      <div class="panel result-panel">
        <div class="result-content">
          <p class="eyebrow">${won ? "SAFE ZONE REACHED" : "RUN TERMINATED · SIGNAL LOST"}</p>
          <h2 class="${won ? "" : "fail"}">${won ? "撤离成功" : "任务失败"}</h2>
          <div class="result-visual">
            <div class="result-scene" aria-label="${resultScene.mainCaption}">
              <img src="${resultScene.image}" alt="${resultScene.alt}" />
            </div>
            <div class="result-copy">
              <div class="result-copy-main">${resultScene.mainCaption}</div>
              <div class="result-copy-sub">${resultScene.subCaption}</div>
            </div>
          </div>
          <p class="result-reason"><strong>原因</strong>：${reason}</p>
          <div class="result-highlights">
            <div><span>逃离距离</span><b>${distance}m</b></div>
            <div><span>本局拾取最多</span><b>${mostCollectedPickup.label}</b><small>${mostCollectedPickup.count ? `${mostCollectedPickup.count} 次` : "暂无拾取"}</small></div>
          </div>
          <div class="result-details">
            <div><span>用时</span><b>${this.elapsed.toFixed(1)} 秒</b></div>
            <div><span>碰撞</span><b>${Math.max(0, 3 - this.health)} 次</b></div>
            <div><span>车辆状态</span><b>${this.health} / 3</b></div>
            <div><span>压力峰值</span><b>${Math.round(this.danger)}%</b></div>
          </div>
          <button class="primary-button" data-action="restart" type="button">${won ? "再跑一圈" : "重新突围"} <span>↻</span></button>
        </div>
      </div>
    `;
  }

  switchLane(direction) {
    if (this.state !== "playing") return;
    const nextLane = clamp(this.lane + direction, 0, 2);
    if (nextLane === this.lane) return;
    this.lane = nextLane;
    const x = this.laneX(this.lane, PLAYER_Y);
    this.spawnParticles(x, PLAYER_Y + 28, 5, "#9f7bff");
  }

  spawnWave() {
    if (this.distance < INTRO_SAFE_DISTANCE) return;

    const z = VIEW_DISTANCE + 25;
    const progress = clamp(this.distance / TOTAL_DISTANCE, 0, 1);
    const availableLanes = [0, 1, 2].filter((lane) => !this.isLaneBlockedNear(lane, z));
    if (availableLanes.length < 2) return;

    // Keep the safe route readable: it can move by one lane per wave, but not jump
    // from the far left to the far right in a single step.
    const nearbySafeLanes = availableLanes.filter((lane) => Math.abs(lane - this.safeLane) <= 1);
    const safeLane = randomItem(nearbySafeLanes.length ? nearbySafeLanes : availableLanes);
    this.safeLane = safeLane;

    const obstacleLanes = availableLanes.filter((lane) => lane !== safeLane);
    if (obstacleLanes.length === 0) return;

    // Single obstacles form the normal rhythm. Double obstacles are occasional,
    // never consecutive, and only start after the player has had time to settle in.
    const pairChance = 0.07 + progress * 0.12;
    const pair = !this.lastWaveWasPair && this.distance > 420 && obstacleLanes.length === 2 && Math.random() < pairChance;
    const firstLane = randomItem(obstacleLanes);
    this.spawnObstacle(firstLane, z);
    if (pair) {
      const secondLane = obstacleLanes.find((lane) => lane !== firstLane);
      this.spawnObstacle(secondLane, z + 26 - progress * 10);
    } else if (this.distance > 180) {
      const maimaiDue = this.isMaimaiDue(progress);
      if (maimaiDue || Math.random() < this.getPickupChance(progress)) {
        const type = maimaiDue ? "maimai" : weightedPickupType();
        const lane = type === "maimai" ? this.safeLane : randomItem([0, 1, 2]);
        this.spawnPickup(lane, z + 120, type);
      }
    }
    this.lastWaveWasPair = pair;
  }

  getPickupChance(progress) {
    return PRESSURE_BALANCE.pickupChanceStart + progress * PRESSURE_BALANCE.pickupChanceGrowth;
  }

  isMaimaiDue(progress) {
    if (this.distance < PRESSURE_BALANCE.maimaiSafetyDistance) return false;

    // Derive the safety window from the current pickup wave rate and Maimai's
    // share of the weighted pool. This keeps the guarantee tied to tuning above.
    const expectedWaveInterval = Math.max(0.92, 1.12 - progress * 0.14) + 0.09;
    const maimaiShare = PRESSURE_BALANCE.maimaiWeight / PICKUP_TYPES.reduce((sum, item) => sum + item.weight, 0);
    const expectedMaimaiGap = expectedWaveInterval / (this.getPickupChance(progress) * maimaiShare);
    const safetyGap = clamp(
      expectedMaimaiGap * PRESSURE_BALANCE.maimaiSafetyRatio,
      PRESSURE_BALANCE.maimaiSafetyGapMin,
      PRESSURE_BALANCE.maimaiSafetyGapMax,
    );

    return this.elapsed - this.lastMaimaiSpawnElapsed >= safetyGap;
  }

  isLaneBlockedNear(lane, z) {
    return this.obstacles.some(
      (obstacle) => !obstacle.cleared && !obstacle.hit && obstacle.lane === lane && Math.abs(obstacle.z - z) < SAFE_WAVE_GAP,
    );
  }

  spawnObstacle(lane, z) {
    const config = randomItem(ASSETS.obstacles);
    this.obstacles.push({
      lane,
      z,
      file: config.file,
      label: config.label,
      hit: false,
      cleared: false,
    });
  }

  spawnPickup(lane, z, type) {
    this.pickups.push({ lane, z, type, phase: Math.random() * Math.PI * 2, collected: false });
    if (type === "maimai") {
      this.lastMaimaiSpawnElapsed = this.elapsed;
      this.maimaiSpawned += 1;
    }
  }

  spawnYouganTriple() {
    const z = VIEW_DISTANCE + 145;
    for (const lane of [0, 1, 2]) this.spawnPickup(lane, z, "yougan");
  }

  update(dt) {
    if (this.state === "paused") {
      this.updateHud();
      return;
    }
    if (this.state === "countdown") {
      this.countdownTimer -= dt;
      const value = Math.ceil(this.countdownTimer);
      this.countdown.textContent = value > 0 ? value : "GO";
      if (this.countdownTimer <= -0.55) {
        this.state = "playing";
        this.countdown.textContent = "";
      }
      this.updateHud();
      return;
    }
    if (this.state !== "playing") return;

    this.elapsed += dt;
    if (!this.youganTripleSpawned && this.elapsed >= YOUGAN_TRIPLE_GAME_TIME) {
      this.youganTripleSpawned = true;
      this.spawnYouganTriple();
    }
    this.invincibilityTimer = Math.max(0, this.invincibilityTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.toastTimer = Math.max(0, this.toastTimer - dt);
    if (this.toastTimer === 0) this.toast.classList.remove("show");

    const progress = clamp(this.distance / TOTAL_DISTANCE, 0, 1);
    const baseSpeed = SPEED_BALANCE.start + progress * (SPEED_BALANCE.end - SPEED_BALANCE.start);
    const slowMultiplier = this.slowTimer > 0 ? 0.67 : 1;
    const youganMultiplier = this.invincibilityTimer > 0 ? YOUGAN_SPEED_MULTIPLIER : 1;
    this.speed = baseSpeed * slowMultiplier * youganMultiplier;
    this.roadTravel += this.speed * dt;
    this.distance += this.speed * dt * 0.36;
    const naturalPressureRate = PRESSURE_BALANCE.naturalRateStart + progress * PRESSURE_BALANCE.naturalRateGrowth;
    this.danger = clamp(this.danger + dt * naturalPressureRate, 0, 100);
    this.visualLane += (this.lane - this.visualLane) * Math.min(1, dt * 13);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = Math.max(0.92, 1.12 - progress * 0.14) + Math.random() * 0.18;
    }

    for (const obstacle of this.obstacles) {
      obstacle.z -= this.speed * dt;
      if (obstacle.cleared || obstacle.hit) continue;
      if (this.isObstacleColliding(obstacle)) this.hitObstacle(obstacle);
    }
    for (const pickup of this.pickups) {
      pickup.z -= this.speed * dt;
      const laneOverlap = Math.abs(pickup.lane - this.visualLane) < PICKUP_LANE_RADIUS;
      if (!pickup.collected && pickup.z < 105 && pickup.z > 8 && laneOverlap) this.collectPickup(pickup);
    }

    this.obstacles = this.obstacles.filter((item) => item.z > OBJECT_DESPAWN_Z && !item.cleared);
    this.pickups = this.pickups.filter((item) => item.z > -130 && !item.collected);
    this.updateParticles(dt);
    this.updateHud();
    if (this.danger >= 100) this.finish(false, "追车压力爆表，信号已经暴露");
    else if (this.health <= 0) this.finish(false, "连续撞击让车辆失去行动能力");
    else if (this.distance >= TOTAL_DISTANCE) this.finish(true, "穿过安全点，追车已经被甩在夜色里");
  }

  hitObstacle(obstacle) {
    obstacle.hit = true;
    const p = this.project(obstacle);
    this.spawnParticles(p.x, p.y, 18, "#ff637d");
    if (this.invincibilityTimer > 0) {
      this.showToast("无敌状态：安全穿过障碍", 0.9);
      return;
    }
    this.flashTimer = 0.16;
    this.slowTimer = 0.9;
    this.health -= 1;
    this.danger = clamp(this.danger + 18, 0, 100);
    this.showToast(`撞上${obstacle.label} · 车辆受损`, 1.35);
  }

  isObstacleColliding(obstacle) {
    const obstaclePoint = this.project(obstacle);
    const playerX = this.laneX(this.visualLane, PLAYER_Y);
    const horizontalGap = Math.abs(obstaclePoint.x - playerX);
    const horizontalHit = horizontalGap <= PLAYER_HITBOX_HALF_WIDTH + OBSTACLE_HITBOX_HALF_WIDTH;
    const verticalHit = obstaclePoint.y >= COLLISION_ZONE_TOP && obstaclePoint.y <= COLLISION_ZONE_BOTTOM;
    return horizontalHit && verticalHit;
  }

  collectPickup(pickup) {
    pickup.collected = true;
    this.pickupCounts[pickup.type] = (this.pickupCounts[pickup.type] || 0) + 1;
    const p = this.project(pickup);
    const style = PICKUP_STYLES[pickup.type] || PICKUP_STYLES.yougan;
    this.spawnParticles(p.x, p.y, 20, style.color);
    if (pickup.type === "yougan") {
      this.invincibilityTimer = 8;
      this.showToast("柑就完了：无敌 8 秒 · 加速", 1.5);
    } else if (pickup.type === "bunnyGrenade") {
      const target = this.obstacles
        .filter((obstacle) => obstacle.lane === this.lane && !obstacle.cleared && !obstacle.hit && obstacle.z > 0)
        .sort((a, b) => a.z - b.z)[0];
      if (target) {
        target.cleared = true;
        const targetPoint = this.project(target);
        this.spawnParticles(targetPoint.x, targetPoint.y, 26, "#ff637d");
        this.showToast(`小兔手雷：炸掉${target.label}`, 1.5);
      } else {
        this.showToast("小兔手雷：当前车道没有目标", 1.35);
      }
    } else {
      this.danger = clamp(this.danger - 26, 0, 100);
      this.showToast("来个麦麦：追车压力 -26", 1.5);
    }
  }

  updateHud() {
    const roundedDistance = Math.round(this.distance);
    const roundedHealth = Math.max(0, this.health);
    document.querySelector("#distance-value").textContent = roundedDistance;
    document.querySelector("#danger-value").textContent = `${Math.round(this.danger)}%`;
    document.querySelector("#danger-fill").style.width = `${this.danger}%`;
    document.querySelector("#durability-value").textContent = "♥".repeat(roundedHealth) + "♡".repeat(Math.max(0, 3 - roundedHealth));
    if (this.distanceFill) this.distanceFill.style.width = `${clamp((this.distance / TOTAL_DISTANCE) * 100, 0, 100)}%`;
    if (this.healthFill) this.healthFill.style.width = `${(roundedHealth / 3) * 100}%`;
    if (this.healthLabel) this.healthLabel.textContent = `${roundedHealth} / 3`;
    this.updatePauseButton();
    this.flash.classList.toggle("active", this.flashTimer > 0);
  }

  updatePauseButton() {
    if (!this.pauseButton) return;
    const paused = this.state === "paused";
    this.pauseButton.classList.toggle("is-paused", paused);
    this.pauseButton.setAttribute("aria-label", paused ? "继续游戏" : "暂停游戏");
    this.pauseButton.title = paused ? "继续游戏" : "暂停游戏";
  }

  updateMuteButton() {
    if (!this.muteButton) return;
    this.muteButton.classList.toggle("is-muted", this.muted);
    this.muteButton.setAttribute("aria-label", this.muted ? "取消静音" : "静音");
    this.muteButton.title = this.muted ? "取消静音" : "静音";
    this.muteButton.setAttribute("aria-pressed", String(this.muted));
  }

  showToast(message, duration = 1.5) {
    this.toast.textContent = message;
    this.toast.classList.add("show");
    this.toastTimer = duration;
  }

  laneX(lane, y) {
    return ROAD_LEFT + (lane + 0.5) * LANE_WIDTH;
  }

  project(item) {
    // Keep the y position unbounded so objects continue moving off the canvas
    // instead of sticking to the road's bottom edge after they pass the player.
    const progress = 1 - item.z / VIEW_DISTANCE;
    const y = HORIZON + progress * (PLAYER_Y - HORIZON + 70);
    return {
      x: this.laneX(item.lane, y),
      y,
      depth: clamp(progress, 0, 1),
      scale: 1,
    };
  }

  spawnParticles(x, y, amount, color) {
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 20 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: 2 + Math.random() * 4,
        color,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
      });
    }
  }

  updateParticles(dt) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 38 * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  frame(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 30);
    this.lastTime = now;
    this.update(dt);
    this.draw();
    requestAnimationFrame((time) => this.frame(time));
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.drawBackdrop(ctx);
    this.drawRoad(ctx);

    const objects = [...this.obstacles, ...this.pickups].sort((a, b) => b.z - a.z);
    for (const object of objects) {
      if (object.z > VIEW_DISTANCE + 80 || object.z < OBJECT_DESPAWN_Z) continue;
      if (object.type) this.drawPickup(ctx, object);
      else if (!object.cleared) this.drawObstacle(ctx, object);
    }

    this.drawChaserPressure(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    if (this.danger > 72) {
      const intensity = (this.danger - 72) / 28;
      const gradient = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 470);
      gradient.addColorStop(0, "rgba(255, 45, 87, 0)");
      gradient.addColorStop(1, `rgba(255, 45, 87, ${0.18 * intensity})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawBackdrop(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#12142b");
    sky.addColorStop(0.47, "#202044");
    sky.addColorStop(1, "#090b18");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(197, 169, 255, .38)";
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 73 + 19) % W;
      const y = 24 + ((i * 47) % 210);
      const size = i % 4 === 0 ? 1.5 : 0.8;
      ctx.globalAlpha = 0.4 + ((i * 13) % 6) / 10;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(8, 9, 20, .58)";
    for (let i = 0; i < 15; i += 1) {
      const x = i * 32 - 12;
      const width = 18 + ((i * 17) % 24);
      const height = 22 + ((i * 29) % 62);
      ctx.fillRect(x, HORIZON - height + 8, width, height);
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(245, 196, 108, .25)";
        ctx.fillRect(x + 5, HORIZON - height + 17, 2, 3);
        ctx.fillStyle = "rgba(8, 9, 20, .58)";
      }
    }
    ctx.fillStyle = "rgba(87, 217, 255, .12)";
    ctx.fillRect(0, HORIZON - 1, W, 2);
  }

  drawRoad(ctx) {
    const road = ctx.createLinearGradient(0, HORIZON, 0, H);
    road.addColorStop(0, "#242641");
    road.addColorStop(1, "#14162b");
    ctx.fillStyle = road;
    ctx.fillRect(ROAD_LEFT, HORIZON, ROAD_WIDTH, H - HORIZON);

    ctx.fillStyle = "rgba(8, 10, 24, .68)";
    ctx.fillRect(ROAD_LEFT - 7, HORIZON, 7, H - HORIZON);
    ctx.fillRect(ROAD_LEFT + ROAD_WIDTH, HORIZON, 7, H - HORIZON);

    ctx.strokeStyle = "rgba(87, 217, 255, .55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ROAD_LEFT, HORIZON);
    ctx.lineTo(ROAD_LEFT, H);
    ctx.moveTo(ROAD_LEFT + ROAD_WIDTH, HORIZON);
    ctx.lineTo(ROAD_LEFT + ROAD_WIDTH, H);
    ctx.stroke();

    ctx.strokeStyle = "rgba(197, 169, 255, .44)";
    ctx.lineWidth = 2;
    ctx.setLineDash([34, 30]);
    ctx.lineDashOffset = -(this.roadTravel % 64);
    for (const laneBoundary of [1, 2]) {
      const x = ROAD_LEFT + laneBoundary * LANE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, HORIZON);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.setLineDash([15, 16]);
    ctx.lineDashOffset = -((this.roadTravel * 0.8) % 31);
    ctx.strokeStyle = "rgba(245, 196, 108, .48)";
    ctx.lineWidth = 3;
    for (const side of [ROAD_LEFT - 3, ROAD_LEFT + ROAD_WIDTH + 3]) {
      ctx.beginPath();
      ctx.moveTo(side, HORIZON);
      ctx.lineTo(side, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  drawObstacle(ctx, obstacle) {
    const image = this.images.get(obstacle.file);
    if (!image?.complete) return;
    const point = this.project(obstacle);
    const height = 92;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "rgba(0, 0, 0, .45)";
    ctx.beginPath();
    ctx.ellipse(point.x, point.y + height * 0.23, height * 0.2, height * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.drawRotatedImage(ctx, image, point.x, point.y, height, 0.88);
  }

  drawPickup(ctx, pickup) {
    const style = PICKUP_STYLES[pickup.type] || PICKUP_STYLES.yougan;
    const image = this.images.get(style.file);
    if (!image?.complete) return;
    const point = this.project(pickup);
    const targetHeight = 52;
    const ratio = (image.naturalWidth || 1) / (image.naturalHeight || 1);
    const targetWidth = targetHeight * ratio;
    const phase = pickup.phase || 0;
    const bob = Math.sin(this.elapsed * 3.4 + phase) * 2.5;
    const pulse = 0.97 + (Math.sin(this.elapsed * 4.2 + phase) + 1) * 0.025;
    const centerY = point.y + bob;
    const radius = 31;

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "rgba(0, 0, 0, .68)";
    ctx.beginPath();
    ctx.arc(point.x, point.y + 4, radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 24;
    ctx.shadowColor = style.color;
    const halo = ctx.createRadialGradient(point.x - 5, centerY - 6, 2, point.x, centerY, radius * 1.22);
    halo.addColorStop(0, `${style.color}66`);
    halo.addColorStop(0.56, `${style.color}25`);
    halo.addColorStop(1, `${style.color}00`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius * 1.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const badge = ctx.createRadialGradient(point.x - 9, centerY - 10, 2, point.x, centerY, radius);
    badge.addColorStop(0, "rgba(255, 255, 255, .2)");
    badge.addColorStop(0.22, `${style.color}7a`);
    badge.addColorStop(0.72, "rgba(16, 16, 40, .92)");
    badge.addColorStop(1, "rgba(7, 8, 22, .98)");
    ctx.fillStyle = badge;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = `${style.color}e8`;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, .45)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius - 5, -2.62, -1.18);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.74;
    ctx.strokeStyle = `${style.color}c9`;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([8, 5]);
    ctx.lineDashOffset = -(this.elapsed * 14 + phase * 10);
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = `${style.color}dd`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius + 5, -2.55, -0.58);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, .5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(point.x, centerY, radius + 9, -2.52, -1.48);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(point.x, centerY);
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.arc(0, 0, radius - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.shadowColor = "rgba(0, 0, 0, .75)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(image, -targetWidth / 2, -targetHeight / 2 + 2, targetWidth, targetHeight);
    ctx.globalAlpha = 1;
    ctx.drawImage(image, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    ctx.restore();
  }

  drawChaserPressure(ctx) {
    const image = this.images.get(ASSETS.chaser);
    if (!image?.complete || this.danger < 35) return;
    const pulse = 0.45 + Math.sin(this.elapsed * 5) * 0.12;
    const width = 55 + this.danger * 0.18;
    ctx.save();
    ctx.globalAlpha = ((this.danger - 30) / 100) * pulse;
    ctx.translate(W / 2, 76 + (100 - this.danger) * 0.2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, -width / 2, -width * 0.3, width, width * 0.6);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ff637d";
    ctx.font = "800 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("追车信号", W / 2, 105);
    ctx.restore();
  }

  drawPlayer(ctx) {
    const image = this.images.get(ASSETS.player);
    if (!image?.complete) return;
    const x = this.laneX(this.visualLane, PLAYER_Y);
    const height = 146;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.shadowBlur = 24;
    ctx.shadowColor = "#57d9ff";
    ctx.fillStyle = "#57d9ff";
    ctx.beginPath();
    ctx.ellipse(x, PLAYER_Y + 42, 33, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (this.invincibilityTimer > 0) {
      const expiring = this.invincibilityTimer <= 2;
      const pulse = expiring ? (Math.sin(this.elapsed * 18) > 0 ? 1 : 0.16) : 0.42 + Math.sin(this.elapsed * 7) * 0.1;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#f5c46c";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 17;
      ctx.shadowColor = "#f5c46c";
      ctx.beginPath();
      ctx.ellipse(x, PLAYER_Y, 47, 91, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    this.drawRotatedImage(ctx, image, x, PLAYER_Y, height, 1);
  }

  drawRotatedImage(ctx, image, x, y, screenHeight, alpha) {
    const ratio = (image.naturalHeight || 1024) / (image.naturalWidth || 1664);
    const screenWidth = screenHeight * ratio;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, -screenHeight / 2, -screenWidth / 2, screenHeight, screenWidth);
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    for (const particle of this.particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

new MobileChaseGame();
