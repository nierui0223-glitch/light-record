const STORAGE_KEY = "light-record-prototype-v1";
const TEST_PROFILE_IDS = new Set(["ning", "family"]);
const DATA_VERSION = 2;
const LIVE_APP_URL = "https://nierui0223-glitch.github.io/light-record/";
const LIVE_APP_ORIGIN = new URL(LIVE_APP_URL).origin;
let deferredInstallPrompt = null;
let pendingImportState = null;
let migrationTimer = null;
let trendRange = 7;
let currentView = "home";
let hiddenAt = 0;

const defaultState = {
  activeProfile: null,
  profiles: [],
  records: {}
};

let state = loadState();
saveState();
let currentAdvice = 0;
const adviceList = [
  { title: "午餐补一份蛋白质", body: "今天早餐记录显示蛋白质偏少，午餐可以加一份鸡蛋、鱼肉或豆制品，让下午更稳定。", source: "基于：早餐记录 · 最近 3 天饱腹感" },
  { title: "下午先补一杯水", body: "今天饮水完成度还不到一半，先补充 300 ml 水，再判断下午的饥饿感。", source: "基于：饮水进度 · 今日活动水平" },
  { title: "今晚提前半小时睡", body: "近一周平均睡眠略低于目标，今晚把睡前刷手机的时间提前收尾，帮助恢复。", source: "基于：7 天睡眠 · 体重趋势" }
];

const commonFoods = [
  { id: "rice", name: "米饭", unit: "1 碗", carbs: 50, protein: 5, fat: 1 },
  { id: "noodles", name: "面条", unit: "1 碗", carbs: 55, protein: 9, fat: 3 },
  { id: "sweet-potato", name: "红薯", unit: "1 个", carbs: 35, protein: 2, fat: 0 },
  { id: "egg", name: "鸡蛋", unit: "1 个", carbs: 1, protein: 6, fat: 5 },
  { id: "chicken", name: "鸡胸肉", unit: "100 g", carbs: 0, protein: 31, fat: 4 },
  { id: "beef", name: "牛肉", unit: "100 g", carbs: 0, protein: 26, fat: 10 },
  { id: "tofu", name: "豆腐", unit: "100 g", carbs: 3, protein: 10, fat: 5 },
  { id: "salmon", name: "三文鱼", unit: "100 g", carbs: 0, protein: 20, fat: 13 },
  { id: "greens", name: "绿叶菜", unit: "1 盘", carbs: 8, protein: 3, fat: 1 },
  { id: "apple", name: "苹果", unit: "1 个", carbs: 25, protein: 1, fat: 0 },
  { id: "banana", name: "香蕉", unit: "1 根", carbs: 23, protein: 1, fat: 0 },
  { id: "milk", name: "牛奶", unit: "250 ml", carbs: 12, protein: 8, fat: 8 },
  { id: "yogurt", name: "酸奶", unit: "1 杯", carbs: 15, protein: 8, fat: 3 },
  { id: "nuts", name: "坚果", unit: "1 小把", carbs: 6, protein: 6, fat: 15 }
];

const drinkTypes = [
  { id: "water", name: "白水", icon: "水", counts: true },
  { id: "tea", name: "无糖茶", icon: "茶", counts: true },
  { id: "coffee", name: "黑咖啡", icon: "咖", counts: true },
  { id: "milk", name: "牛奶", icon: "奶", counts: true },
  { id: "sugar-free", name: "无糖饮料", icon: "零", counts: true },
  { id: "sugary", name: "含糖饮料", icon: "糖", counts: false },
  { id: "custom", name: "其他饮品", icon: "＋", counts: true }
];

const activityLevels = [
  { value: 1.2, label: "久坐为主" },
  { value: 1.375, label: "每周轻度运动 1～3 次" },
  { value: 1.55, label: "每周中等运动 3～5 次" },
  { value: 1.725, label: "每周高强度运动 6～7 次" }
];

function activityOptions(selected) {
  return activityLevels.map((level) => `<option value="${level.value}" ${Number(selected) === level.value ? "selected" : ""}>${level.label}</option>`).join("");
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyDailyRecord(weight) {
  return {
    weight: Number(weight) || 65,
    average: Number(weight) || 65,
    weightRecorded: false,
    water: 0,
    waterGoal: 1800,
    waterLogs: [],
    meal: false,
    mealRecords: [],
    sleep: ""
  };
}

function normalizeDailyRecord(record, fallbackWeight) {
  const normalized = { ...emptyDailyRecord(fallbackWeight), ...(record || {}) };
  normalized.weight = Number(normalized.weight) || Number(fallbackWeight) || 65;
  normalized.average = Number(normalized.average) || normalized.weight;
  normalized.water = Number(normalized.water) || 0;
  normalized.waterGoal = Number(normalized.waterGoal) || 1800;
  normalized.waterLogs = Array.isArray(normalized.waterLogs) ? normalized.waterLogs : [];
  normalized.mealRecords = Array.isArray(normalized.mealRecords) ? normalized.mealRecords : [];
  normalized.meal = Boolean(normalized.meal || normalized.mealRecords.length);
  return normalized;
}

function normalizeState(candidate) {
  const saved = { ...defaultState, ...(candidate || {}) };
  saved.profiles = (Array.isArray(saved.profiles) ? saved.profiles : []).filter((profile) => profile?.id && !TEST_PROFILE_IDS.has(profile.id));
  saved.records = saved.records && typeof saved.records === "object" ? saved.records : {};
  TEST_PROFILE_IDS.forEach((id) => delete saved.records[id]);
  const today = localDateKey();

  saved.profiles.forEach((profile) => {
    const existing = saved.records[profile.id];
    if (existing?.days && typeof existing.days === "object") {
      const weightHistory = Array.isArray(existing.weightHistory) ? existing.weightHistory : [];
      const fallbackWeight = Number(weightHistory.at(-1)?.weight || profile.startWeight) || 65;
      Object.keys(existing.days).forEach((date) => {
        existing.days[date] = normalizeDailyRecord(existing.days[date], fallbackWeight);
      });
      existing.weightHistory = weightHistory
        .filter((item) => item?.date && Number(item.weight))
        .map((item) => ({ date: item.date, weight: Number(item.weight) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      saved.records[profile.id] = existing;
      return;
    }

    const migrated = normalizeDailyRecord(existing, profile.startWeight);
    migrated.weightRecorded = Boolean(existing && Number(existing.weight));
    saved.records[profile.id] = {
      days: { [today]: migrated },
      weightHistory: migrated.weightRecorded ? [{ date: today, weight: migrated.weight }] : []
    };
  });
  if (!saved.profiles.some((profile) => profile.id === saved.activeProfile)) saved.activeProfile = saved.profiles[0]?.id || null;
  saved.dataVersion = DATA_VERSION;
  return saved;
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    showToast("本地图片空间不足，请选择尺寸更小的图片");
    return false;
  }
}
function activeProfile() {
  const profile = state.profiles.find((item) => item.id === state.activeProfile) || state.profiles[0] || null;
  if (!profile) return null;
  const history = state.records[profile.id]?.weightHistory || [];
  profile.startWeight ||= Number(history[0]?.weight) || 65;
  profile.targetWeight ||= Math.max(40, profile.startWeight - 5);
  profile.planWeeks ||= 12;
  profile.startedAt ||= new Date().toISOString().slice(0, 10);
  return profile;
}
function activeProfileStore() {
  return state.records[state.activeProfile] || null;
}
function activeRecord() {
  const store = activeProfileStore();
  if (!store) return null;
  store.days ||= {};
  store.weightHistory ||= [];
  const date = localDateKey();
  if (!store.days[date]) {
    const latestWeight = Number(store.weightHistory.at(-1)?.weight || activeProfile()?.startWeight) || 65;
    store.days[date] = emptyDailyRecord(latestWeight);
  }
  const record = store.days[date];
  record.waterLogs ||= [];
  record.mealRecords ||= [];
  const recentWeights = store.weightHistory.slice(-7).map((item) => Number(item.weight)).filter(Boolean);
  record.average = recentWeights.length ? recentWeights.reduce((sum, value) => sum + value, 0) / recentWeights.length : record.weight;
  return record;
}

function renderHome() {
  const profile = activeProfile();
  const record = activeRecord();
  if (!profile || !record) return;
  document.querySelector("#greeting-name").textContent = profile.name;
  const avatar = document.querySelector("#profile-avatar");
  avatar.textContent = profile.avatarData ? "" : profile.initial;
  avatar.className = `avatar avatar-${profile.color === "mint" ? "mint" : "coral"}${profile.avatarData ? " has-image" : ""}`;
  avatar.style.backgroundImage = profile.avatarData ? `url(${profile.avatarData})` : "";
  const dashboard = document.querySelector(".hero-card");
  dashboard.classList.toggle("has-photo", Boolean(profile.dashboardBackground));
  dashboard.style.backgroundImage = profile.dashboardBackground ? `linear-gradient(rgba(28, 48, 41, .66), rgba(28, 48, 41, .88)), url(${profile.dashboardBackground})` : "";
  document.querySelector("#current-weight").textContent = Number(record.weight).toFixed(1);
  document.querySelector("#average-weight").textContent = `${Number(record.average).toFixed(1)} kg`;
  const weightDifference = Number(record.weight) - Number(record.average);
  document.querySelector("#weight-delta").textContent = Math.abs(weightDifference) < .05 ? "与均值持平" : `${weightDifference < 0 ? "↓" : "↑"} ${Math.abs(weightDifference).toFixed(1)} kg`;
  document.querySelector("#water-status").textContent = `${record.water} / ${record.waterGoal} ml`;
  document.querySelector("#meal-status").textContent = record.meal ? "今日已记录" : "午餐待记录";
  const completed = [record.weightRecorded, record.meal, record.water >= record.waterGoal, Boolean(record.sleep)].filter(Boolean).length;
  document.querySelector("#completion-label").textContent = `${completed} / 4 已完成`;
  document.querySelector("#weight-status").textContent = record.weightRecorded ? "已记录" : "待记录";
  document.querySelector("#sleep-status").textContent = record.sleep || "待记录";
  renderTodayNutrition(record, profile);
  renderGoalAdvice();
  renderWeightTrend();
  renderWeeklySnapshot();
  if (currentView === "trend") renderTrend();
}

function renderWeightTrend() {
  const history = (activeProfileStore()?.weightHistory || []).slice(-7);
  const line = document.querySelector("#sparkline-line");
  const fill = document.querySelector("#sparkline-fill");
  const dot = document.querySelector("#sparkline-dot");
  const status = document.querySelector("#weight-trend-status");
  if (!history.length) {
    line.setAttribute("d", "M0 72 L560 72");
    fill.setAttribute("d", "M0 72 L560 72 L560 130 L0 130 Z");
    dot.setAttribute("cx", "560");
    dot.setAttribute("cy", "72");
    status.innerHTML = '<span class="status-dot"></span>开始记录';
    return;
  }
  const values = history.map((item) => Number(item.weight));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(.8, max - min);
  const points = values.map((value, index) => {
    const x = history.length === 1 ? 560 : index / (history.length - 1) * 560;
    const y = 100 - (value - min) / range * 76;
    return { x: Math.round(x), y: Math.round(y) };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  const last = points.at(-1);
  line.setAttribute("d", path);
  fill.setAttribute("d", `${path} L560 130 L${points[0].x} 130 Z`);
  dot.setAttribute("cx", String(last.x));
  dot.setAttribute("cy", String(last.y));
  const change = values.at(-1) - values[0];
  const label = history.length < 2 ? "已记录 1 天" : change < -.05 ? "趋势向下" : change > .05 ? "近期上升" : "近期平稳";
  status.innerHTML = `<span class="status-dot"></span>${label}`;
  const firstDate = new Date(`${history[0].date}T00:00:00`);
  document.querySelector("#chart-start-label").textContent = history.length < 2 ? "今天" : `${String(firstDate.getMonth() + 1).padStart(2, "0")}/${String(firstDate.getDate()).padStart(2, "0")}`;
}

function renderWeeklySnapshot() {
  const store = activeProfileStore();
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return localDateKey(date);
  });
  const storedDates = Object.keys(store?.days || {}).sort();
  const firstDate = storedDates[0] || localDateKey();
  const eligibleDates = dates.filter((date) => date >= firstDate);
  const records = eligibleDates.map((date) => store?.days?.[date]).filter(Boolean);
  const mealDays = records.filter((record) => record.mealRecords?.length).length;
  const waterPercent = eligibleDates.length
    ? Math.round(records.reduce((sum, record) => sum + Math.min(1, Number(record.water || 0) / Number(record.waterGoal || 1800)), 0) / eligibleDates.length * 100)
    : 0;
  const sleeps = records.map((record) => sleepHours(record.sleep)).filter(Boolean);
  const averageSleep = sleeps.length ? sleeps.reduce((sum, hours) => sum + hours, 0) / sleeps.length : 0;
  document.querySelector("#weekly-meals").textContent = `${mealDays} / ${eligibleDates.length || 1}`;
  document.querySelector("#weekly-water").textContent = `${waterPercent}%`;
  document.querySelector("#weekly-sleep").textContent = averageSleep ? `${Math.floor(averageSleep)}h ${Math.round((averageSleep % 1) * 60)}m` : "--";
}

function periodDates(days) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - index));
    return localDateKey(date);
  });
}

function shortDate(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function recordCalories(record) {
  const foods = (record?.mealRecords || []).flatMap((meal) => meal.foods || []);
  return macroSummary(foods).calories;
}

function renderHabitBars(elementId, entries, valueFor, targetFor, type) {
  const element = document.querySelector(elementId);
  element.className = `habit-bars habit-bars--${type}${entries.length > 7 ? " is-month" : ""}`;
  element.innerHTML = entries.map((entry) => {
    const value = valueFor(entry);
    const target = Math.max(1, targetFor(entry));
    const percent = value ? Math.max(8, Math.min(100, value / target * 100)) : 4;
    const onTarget = value >= target * .9 && value <= target * 1.1;
    const label = value ? `${Math.round(value)} / ${Math.round(target)}` : "未记录";
    return `<i class="${value ? "has-value" : ""}${onTarget ? " is-on-target" : ""}" style="height:${percent}%" title="${shortDate(entry.date)} ${label}"></i>`;
  }).join("");
}

function renderTrendWeightChart(history, dates) {
  const chart = document.querySelector("#trend-weight-chart");
  const empty = document.querySelector("#trend-weight-empty");
  if (history.length < 2) {
    chart.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const values = history.map((item) => Number(item.weight));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max(.4, (maximum - minimum) * .25);
  const lower = minimum - padding;
  const upper = maximum + padding;
  const range = upper - lower;
  const points = history.map((item) => {
    const dayIndex = Math.max(0, dates.indexOf(item.date));
    const x = 30 + dayIndex / Math.max(1, dates.length - 1) * 318;
    const y = 132 - (Number(item.weight) - lower) / range * 112;
    return { x, y, weight: Number(item.weight), date: item.date };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const circles = points.map((point) => `<circle class="trend-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5"><title>${shortDate(point.date)} ${point.weight.toFixed(1)} kg</title></circle>`).join("");
  chart.innerHTML = `<line class="trend-grid-line" x1="30" y1="20" x2="348" y2="20"></line><line class="trend-grid-line" x1="30" y1="76" x2="348" y2="76"></line><line class="trend-grid-line" x1="30" y1="132" x2="348" y2="132"></line><text class="trend-axis-label" x="0" y="24">${maximum.toFixed(1)}</text><text class="trend-axis-label" x="0" y="136">${minimum.toFixed(1)}</text><path class="trend-area" d="${path} L${points.at(-1).x.toFixed(1)} 142 L${points[0].x.toFixed(1)} 142 Z"></path><path class="trend-line" d="${path}"></path>${circles}<text class="trend-axis-label" x="30" y="160">${shortDate(history[0].date)}</text><text class="trend-axis-label" x="348" y="160" text-anchor="end">${shortDate(history.at(-1).date)}</text>`;
}

function trendInsight({ trackedDays, weightChange, weightDays, averageCalories, caloriePlan, waterRate, averageSleep }) {
  if (trackedDays < 3) return { title: "先连续记录几天", body: "至少连续记录 3 天后，趋势判断会更可靠。每天完成体重、饮食、饮水和睡眠中的大部分记录即可。" };
  if (weightDays >= 2 && weightChange < 0 && Math.abs(weightChange) / Math.max(1, trendRange / 7) > .8) return { title: "近期下降速度偏快", body: "体重短期下降较快时，不建议继续压低饮食。优先保证蛋白质、规律三餐和睡眠，并观察下一周的平均体重。" };
  if (averageSleep && averageSleep < 7) return { title: "睡眠是本周期的优先项", body: `本周期平均睡眠 ${averageSleep.toFixed(1)} 小时。先把入睡时间提前 20～30 分钟，比继续减少热量更有利于稳定执行。` };
  if (waterRate !== null && waterRate < 60) return { title: "饮水达标率还有提升空间", body: "把饮水分到起床、午餐和下午三个固定时间点，比临睡前集中补水更容易长期坚持。" };
  if (caloriePlan.complete && averageCalories > caloriePlan.upper) return { title: "平均摄入略高于建议范围", body: "先减少高油、高糖饮品或零食中的一项，不需要同时压缩正餐主食和蛋白质。" };
  if (weightDays >= 2 && weightChange <= 0) return { title: "当前节奏稳定", body: "体重方向与目标一致。继续保持现有饮食结构和记录频率，优先看 7 天平均，不被单日波动干扰。" };
  return { title: "先观察完整一周", body: "当前记录还不足以判断平台期。保持计划不变并继续记录，满 7 天后再根据平均体重调整饮食。" };
}

function renderTrend() {
  const profile = activeProfile();
  const store = activeProfileStore();
  if (!profile || !store) return;
  const dates = periodDates(trendRange);
  const entries = dates.map((date) => ({ date, record: store.days?.[date] || null }));
  const firstDate = dates[0];
  const history = (store.weightHistory || []).filter((item) => item.date >= firstDate && item.date <= dates.at(-1));
  const currentWeight = Number(store.weightHistory?.at(-1)?.weight || activeRecord().weight || profile.startWeight);
  const totalGoal = Math.max(.1, Number(profile.startWeight) - Number(profile.targetWeight));
  const goalProgress = Math.max(0, Math.min(100, (Number(profile.startWeight) - currentWeight) / totalGoal * 100));
  document.querySelector("#trend-period-label").textContent = `近 ${trendRange} 天的身体与习惯变化`;
  document.querySelector("#trend-goal-percent").textContent = `${Math.round(goalProgress)}%`;
  document.querySelector("#trend-goal-bar").style.width = `${goalProgress}%`;
  document.querySelector("#trend-start-weight").textContent = `${Number(profile.startWeight).toFixed(1)} kg`;
  document.querySelector("#trend-current-weight").textContent = `${currentWeight.toFixed(1)} kg`;
  document.querySelector("#trend-target-weight").textContent = `${Number(profile.targetWeight).toFixed(1)} kg`;

  const weightChange = history.length >= 2 ? Number(history.at(-1).weight) - Number(history[0].weight) : 0;
  const weightChangeElement = document.querySelector("#trend-weight-change");
  weightChangeElement.textContent = history.length >= 2 ? `${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} kg` : "--";
  weightChangeElement.className = history.length < 2 ? "" : weightChange <= 0 ? "is-positive" : "is-warning";
  document.querySelector("#trend-weight-days").textContent = history.length ? `${history.length} 次体重记录` : "暂无记录";
  document.querySelector("#trend-weight-caption").textContent = history.length >= 2 ? `${Number(history[0].weight).toFixed(1)} → ${Number(history.at(-1).weight).toFixed(1)} kg` : "继续记录形成趋势";
  renderTrendWeightChart(history, dates);

  const calorieEntries = entries.map((entry) => ({ ...entry, calories: recordCalories(entry.record) }));
  const calorieDays = calorieEntries.filter((entry) => entry.calories > 0);
  const averageCalories = calorieDays.length ? calorieDays.reduce((sum, entry) => sum + entry.calories, 0) / calorieDays.length : 0;
  const caloriePlan = dailyCaloriePlan(profile, activeRecord());
  document.querySelector("#trend-calorie-average").textContent = calorieDays.length ? `${Math.round(averageCalories)} kcal` : "--";
  document.querySelector("#trend-calorie-note").textContent = calorieDays.length ? `${calorieDays.length} 天有记录 · 均值 ${Math.round(averageCalories)} kcal` : "暂无记录";
  renderHabitBars("#trend-calorie-bars", calorieEntries, (entry) => entry.calories, () => caloriePlan.complete ? caloriePlan.center : Math.max(1, averageCalories), "calorie");

  const waterDays = entries.filter((entry) => Number(entry.record?.water) > 0);
  const waterMet = waterDays.filter((entry) => Number(entry.record.water) >= Number(entry.record.waterGoal || 1800)).length;
  const waterRate = waterDays.length ? Math.round(waterMet / waterDays.length * 100) : null;
  document.querySelector("#trend-water-rate").textContent = waterRate === null ? "--" : `${waterRate}%`;
  document.querySelector("#trend-water-days").textContent = waterDays.length ? `${waterMet} / ${waterDays.length} 个记录日` : "暂无记录";
  document.querySelector("#trend-water-note").textContent = waterDays.length ? `${waterMet} 天达到目标` : "暂无记录";
  renderHabitBars("#trend-water-bars", entries, (entry) => Number(entry.record?.water || 0), (entry) => Number(entry.record?.waterGoal || 1800), "water");

  const sleepDays = entries.map((entry) => ({ ...entry, hours: sleepHours(entry.record?.sleep) })).filter((entry) => entry.hours > 0);
  const averageSleep = sleepDays.length ? sleepDays.reduce((sum, entry) => sum + entry.hours, 0) / sleepDays.length : 0;
  document.querySelector("#trend-sleep-average").textContent = sleepDays.length ? `${averageSleep.toFixed(1)} h` : "--";
  document.querySelector("#trend-sleep-days").textContent = sleepDays.length ? `${sleepDays.length} 天有记录` : "暂无记录";
  document.querySelector("#trend-sleep-note").textContent = sleepDays.length ? `平均 ${averageSleep.toFixed(1)} 小时` : "暂无记录";
  renderHabitBars("#trend-sleep-bars", entries, (entry) => sleepHours(entry.record?.sleep), () => 8, "sleep");

  const trackedDays = entries.filter((entry) => entry.record && (entry.record.weightRecorded || entry.record.mealRecords?.length || Number(entry.record.water) || entry.record.sleep)).length;
  const insight = trendInsight({ trackedDays, weightChange, weightDays: history.length, averageCalories, caloriePlan, waterRate, averageSleep });
  document.querySelector("#trend-insight-title").textContent = insight.title;
  document.querySelector("#trend-insight-body").textContent = insight.body;
  document.querySelector("#trend-date-start").textContent = shortDate(dates[0]);
  document.querySelector("#trend-date-middle").textContent = shortDate(dates[Math.floor((dates.length - 1) / 2)]);
  document.querySelector("#trend-date-end").textContent = "今天";
  document.querySelectorAll("[data-trend-range]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.trendRange) === trendRange));
}

function renderDate() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  document.querySelector("#greeting-copy").textContent = greeting;
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short" })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  document.querySelector("#today-label").textContent = `${parts.weekday} · ${parts.day} ${parts.month}`.toUpperCase();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function exportBackup() {
  const backup = {
    app: "sherry的掉秤日记",
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sherry的掉秤日记备份-${localDateKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.lastBackupAt = new Date().toISOString();
  saveState();
  showToast("备份已导出，请保存到手机文件中");
}

async function prepareImport(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const candidate = normalizeState(parsed.state || parsed);
    if (!candidate.profiles.length) throw new Error("备份中没有可恢复的档案");
    pendingImportState = candidate;
    document.querySelector("#modal-title").textContent = "确认恢复备份";
    document.querySelector("#modal-kicker").textContent = "DATA RESTORE";
    document.querySelector("#modal-content").innerHTML = `<div class="backup-warning"><strong>将恢复 ${candidate.profiles.length} 个档案</strong><p>恢复会替换当前浏览器里的全部档案和记录。建议先导出一次当前数据。</p></div><div class="backup-actions"><button class="secondary-button" type="button" id="cancel-import">取消</button><button class="primary-button" type="button" id="confirm-import">确认恢复</button></div>`;
    document.querySelector("#cancel-import").addEventListener("click", openProfiles);
    document.querySelector("#confirm-import").addEventListener("click", () => {
      const previousState = state;
      state = pendingImportState;
      pendingImportState = null;
      if (!saveState()) {
        state = previousState;
        return;
      }
      renderHome();
      closeModal();
      showToast("备份已恢复");
    });
  } catch (error) {
    showToast(error.message || "无法读取这个备份文件");
  }
}

async function installApp() {
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    return showToast("sherry的掉秤日记已经安装到桌面");
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  document.querySelector("#modal-title").textContent = "安装到手机";
  document.querySelector("#modal-kicker").textContent = "ADD TO HOME SCREEN";
  document.querySelector("#modal-content").innerHTML = isIOS
    ? `<div class="install-guide"><b>请使用 Safari 打开正式网址</b><ol><li>点底部的“分享”按钮</li><li>选择“添加到主屏幕”</li><li>点击右上角“添加”</li></ol></div>`
    : `<div class="install-guide"><b>请使用 Chrome 打开正式网址</b><ol><li>点浏览器右上角菜单</li><li>选择“安装应用”或“添加到主屏幕”</li><li>确认安装</li></ol></div>`;
}

function isLocalPreview() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}

function migrateToLiveApp() {
  const target = window.open(LIVE_APP_URL, "_blank");
  if (!target) return showToast("请允许打开新窗口后重试");
  let attempts = 0;
  window.clearInterval(migrationTimer);
  migrationTimer = window.setInterval(() => {
    target.postMessage({ type: "LIGHT_RECORD_MIGRATE", state }, LIVE_APP_ORIGIN);
    attempts += 1;
    if (attempts >= 20) {
      window.clearInterval(migrationTimer);
      showToast("迁移未完成，请改用导出备份");
    }
  }, 500);
}

window.addEventListener("message", (event) => {
  if (event.origin === LIVE_APP_ORIGIN && event.data?.type === "LIGHT_RECORD_MIGRATE_COMPLETE") {
    window.clearInterval(migrationTimer);
    showToast("Sherry 数据已迁移到正式版");
    return;
  }
  if (location.origin !== LIVE_APP_ORIGIN || event.origin !== "http://127.0.0.1:4173" || event.data?.type !== "LIGHT_RECORD_MIGRATE") return;
  const imported = normalizeState(event.data.state);
  if (!imported.profiles.length) return;
  state = imported;
  if (!saveState()) return;
  renderHome();
  closeModal();
  showToast("Sherry 数据迁移成功");
  event.source?.postMessage({ type: "LIGHT_RECORD_MIGRATE_COMPLETE" }, event.origin);
});

function compressImage(file, width, height, quality = .78) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/")) return reject(new Error("请选择图片文件"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片无法打开"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        const sourceRatio = image.width / image.height;
        const targetRatio = width / height;
        let sourceWidth = image.width;
        let sourceHeight = image.height;
        let sourceX = 0;
        let sourceY = 0;
        if (sourceRatio > targetRatio) {
          sourceWidth = image.height * targetRatio;
          sourceX = (image.width - sourceWidth) / 2;
        } else {
          sourceHeight = image.width / targetRatio;
          sourceY = (image.height - sourceHeight) / 2;
        }
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function estimateCustomFood(name) {
  const normalized = name.toLowerCase();
  const matched = commonFoods.find((food) => normalized.includes(food.name.toLowerCase()));
  if (matched) return { ...matched, id: `custom-${Date.now()}`, name, estimated: true };
  const rules = [
    { words: ["饭", "粥", "粉", "面", "饼", "馒头", "包子", "土豆", "玉米"], macros: [48, 8, 5] },
    { words: ["鸡", "鸭", "鱼", "虾", "牛", "猪", "肉", "蛋"], macros: [4, 24, 10] },
    { words: ["菜", "瓜", "菇", "笋", "豆芽", "番茄"], macros: [10, 3, 2] },
    { words: ["奶", "酸奶", "拿铁"], macros: [15, 8, 8] },
    { words: ["糕", "饼干", "薯片", "巧克力", "冰淇淋", "甜品"], macros: [35, 5, 18] }
  ];
  const rule = rules.find((item) => item.words.some((word) => normalized.includes(word)));
  const [carbs, protein, fat] = rule?.macros || [30, 10, 10];
  return { id: `custom-${Date.now()}`, name, unit: "1 份", carbs, protein, fat, estimated: true };
}

function foodCalories(food) {
  return Math.round((food.carbs * 4 + food.protein * 4 + food.fat * 9) * food.quantity);
}

function macroSummary(foods) {
  const totals = foods.reduce((sum, food) => ({
    carbs: sum.carbs + food.carbs * food.quantity,
    protein: sum.protein + food.protein * food.quantity,
    fat: sum.fat + food.fat * food.quantity
  }), { carbs: 0, protein: 0, fat: 0 });
  const energy = { carbs: totals.carbs * 4, protein: totals.protein * 4, fat: totals.fat * 9 };
  const calories = energy.carbs + energy.protein + energy.fat;
  const percent = (value) => calories ? Math.round(value / calories * 100) : 0;
  return { totals, calories: Math.round(calories), carbsPercent: percent(energy.carbs), proteinPercent: percent(energy.protein), fatPercent: percent(energy.fat) };
}

function todayMealRecords(record) {
  return record.mealRecords;
}

function dailyCaloriePlan(profile, record) {
  const complete = [profile.sex, profile.age, profile.height, profile.activity].every(Boolean);
  if (!complete) return { complete: false };
  const weight = Number(record.weight);
  const sexAdjustment = profile.sex === "male" ? 5 : -161;
  const bmr = 10 * weight + 6.25 * Number(profile.height) - 5 * Number(profile.age) + sexAdjustment;
  const maintenance = bmr * Number(profile.activity);
  const elapsedWeeks = Math.max(0, Math.floor((Date.now() - new Date(profile.startedAt).getTime()) / (7 * 24 * 60 * 60 * 1000)));
  const remainingWeeks = Math.max(1, profile.planWeeks - elapsedWeeks);
  const remainingWeight = Math.max(0, weight - profile.targetWeight);
  const weeklyTarget = remainingWeight / remainingWeeks;
  const plannedDeficit = weeklyTarget * 7700 / 7;
  const deficit = Math.min(plannedDeficit, maintenance * .2);
  const center = Math.round(Math.max(bmr, maintenance - deficit) / 50) * 50;
  const lower = Math.max(Math.round(bmr / 50) * 50, center - 100);
  const upper = center + 100;
  return { complete: true, bmr: Math.round(bmr), maintenance: Math.round(maintenance), weeklyTarget, center, lower, upper };
}

function macroStatus(value, min, max, hasData) {
  if (!hasData) return { label: "待记录", className: "is-pending" };
  if (value < min) return { label: "偏低", className: "is-low" };
  if (value > max) return { label: "偏高", className: "is-high" };
  return { label: "合理", className: "is-good" };
}

function setMacroStatus(id, status) {
  const element = document.querySelector(id);
  element.textContent = status.label;
  element.className = status.className;
}

function renderTodayNutrition(record, profile) {
  const meals = todayMealRecords(record);
  const foods = meals.flatMap((meal) => meal.foods || []);
  const summary = macroSummary(foods);
  const plan = dailyCaloriePlan(profile, record);
  document.querySelector("#nutrition-calories").textContent = summary.calories;
  document.querySelector("#nutrition-meals").textContent = meals.length ? `${meals.length} 个餐次` : "尚未记录";
  document.querySelector("#daily-carbs-value").textContent = `${Math.round(summary.totals.carbs)} g · ${summary.carbsPercent}%`;
  document.querySelector("#daily-protein-value").textContent = `${Math.round(summary.totals.protein)} g · ${summary.proteinPercent}%`;
  document.querySelector("#daily-fat-value").textContent = `${Math.round(summary.totals.fat)} g · ${summary.fatPercent}%`;
  document.querySelector("#daily-carbs-bar").style.width = `${summary.carbsPercent}%`;
  document.querySelector("#daily-protein-bar").style.width = `${summary.proteinPercent}%`;
  document.querySelector("#daily-fat-bar").style.width = `${summary.fatPercent}%`;
  document.querySelector("#nutrition-empty").hidden = meals.length > 0;
  setMacroStatus("#daily-carbs-status", macroStatus(summary.carbsPercent, 40, 55, foods.length > 0));
  setMacroStatus("#daily-protein-status", macroStatus(summary.proteinPercent, 20, 30, foods.length > 0));
  setMacroStatus("#daily-fat-status", macroStatus(summary.fatPercent, 25, 35, foods.length > 0));
  const planElement = document.querySelector("#calorie-plan");
  const completeButton = document.querySelector("#complete-calorie-profile");
  completeButton.hidden = plan.complete;
  planElement.classList.toggle("is-incomplete", !plan.complete);
  if (!plan.complete) {
    document.querySelector("#calorie-target").textContent = "待计算";
    document.querySelector("#calorie-remaining").textContent = "完善档案";
    document.querySelector("#calorie-progress-bar").style.width = "0%";
    document.querySelector("#calorie-plan-note").textContent = "需要身高、年龄、性别和活动水平才能计算。";
    return;
  }
  const remainingCalories = plan.center - summary.calories;
  document.querySelector("#calorie-target").textContent = `${plan.lower}～${plan.upper} kcal`;
  document.querySelector("#calorie-remaining").textContent = remainingCalories >= 0 ? `约 ${remainingCalories} kcal` : `超出约 ${Math.abs(remainingCalories)} kcal`;
  document.querySelector("#calorie-remaining").classList.toggle("is-over", remainingCalories < 0);
  document.querySelector("#calorie-progress-bar").style.width = `${Math.min(100, Math.round(summary.calories / plan.center * 100))}%`;
  document.querySelector("#calorie-plan-note").textContent = `估算维持消耗 ${plan.maintenance} kcal；按剩余周期每周约减 ${plan.weeklyTarget.toFixed(2)} kg，热量缺口最多取维持消耗的 20%。`;
}

function sleepHours(value) {
  const match = String(value || "").match(/(\d+)\s*小时(?:\s*(\d+)\s*分)?/);
  return match ? Number(match[1]) + Number(match[2] || 0) / 60 : 0;
}

function sleepDuration(start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function goalAdvice() {
  const profile = activeProfile();
  const record = activeRecord();
  const remaining = Math.max(0, record.weight - profile.targetWeight);
  const elapsedWeeks = Math.max(0, Math.floor((Date.now() - new Date(profile.startedAt).getTime()) / (7 * 24 * 60 * 60 * 1000)));
  const remainingWeeks = Math.max(1, profile.planWeeks - elapsedWeeks);
  const weeklyTarget = remaining / remainingWeeks;
  const safeWeekly = Math.min(.75, profile.startWeight * .01);
  const latestMeal = record.mealRecords.at(-1);
  const latestMealSummary = latestMeal ? latestMeal.summary || macroSummary(latestMeal.foods || []) : null;
  const latestMealLabel = latestMeal?.mealTime || "最近一餐";
  const sleep = sleepHours(record.sleep);
  const suggestions = [];

  if (weeklyTarget > safeWeekly) {
    const recommendedWeeks = Math.ceil(remaining / safeWeekly);
    suggestions.push({ title: "先把减脂节奏调稳", body: `按剩余周期需要每周减 ${weeklyTarget.toFixed(2)} kg，节奏偏快。建议给剩余目标至少留出 ${recommendedWeeks} 周，优先保证饮食和睡眠可持续。`, source: `基于：距离目标 ${remaining.toFixed(1)} kg · 剩余 ${remainingWeeks} 周` });
  } else {
    suggestions.push({ title: `距离目标还有 ${remaining.toFixed(1)} kg`, body: `按剩余计划，每周约下降 ${weeklyTarget.toFixed(2)} kg 即可。今天不需要追求大幅少吃，保持规律三餐并继续观察 7 天平均体重。`, source: `基于：目标 ${profile.targetWeight} kg · 剩余 ${remainingWeeks} 周` });
  }

  if (!latestMeal) {
    suggestions.push({ title: "先记录一顿完整饮食", body: "添加具体食物后，我会根据碳水、蛋白质和脂肪供能占比，给出更贴近目标的调整建议。", source: "基于：今日尚无具体食物记录" });
  } else if (latestMealSummary.proteinPercent < 20) {
    suggestions.push({ title: "下一餐增加优质蛋白", body: `最近一餐蛋白质供能约 ${latestMealSummary.proteinPercent}%，略低。可以增加鸡蛋、鱼虾、瘦肉或豆制品，同时保持主食份量稳定。`, source: `基于：${latestMealLabel}营养估算 · 个人减脂目标` });
  } else if (latestMealSummary.fatPercent > 35) {
    suggestions.push({ title: "下一餐减少隐形油脂", body: `最近一餐脂肪供能约 ${latestMealSummary.fatPercent}%，偏高。下一餐优先清蒸或炖煮，并减少酱料、油炸和坚果叠加。`, source: `基于：${latestMealLabel}营养估算 · 个人减脂目标` });
  } else {
    suggestions.push({ title: "这餐结构可以保持", body: `最近一餐蛋白质供能 ${latestMealSummary.proteinPercent}%、脂肪 ${latestMealSummary.fatPercent}%，整体较平衡。下一餐继续保持具体食物和份量记录。`, source: `基于：${latestMealLabel}营养估算 · 个人减脂目标` });
  }

  if (sleep && sleep < 7) {
    const minutes = Math.round((7.5 - sleep) * 60);
    suggestions.push({ title: "今晚优先补足睡眠", body: `昨晚睡了约 ${sleep.toFixed(1)} 小时。今晚尝试提前 ${Math.min(60, Math.max(20, minutes))} 分钟上床，避免用少吃来弥补体重波动。`, source: "基于：昨晚睡眠 · 减脂恢复需求" });
  } else {
    suggestions.push({ title: "保持稳定的入睡时间", body: "睡眠已接近建议范围，今晚尽量在相近时间入睡。稳定作息有助于控制食欲，也更容易坚持当前计划。", source: "基于：睡眠记录 · 个人减脂周期" });
  }
  return weeklyTarget > safeWeekly ? suggestions : [suggestions[1], suggestions[2], suggestions[0]];
}

function renderGoalAdvice() {
  const suggestions = goalAdvice();
  currentAdvice %= suggestions.length;
  const advice = suggestions[currentAdvice];
  document.querySelector("#advice-title").textContent = advice.title;
  document.querySelector("#advice-body").textContent = advice.body;
  document.querySelector("#advice-body").nextElementSibling.textContent = advice.source;
}

function renderMealSelection(foods) {
  const list = document.querySelector("#selected-foods");
  const analysis = document.querySelector("#meal-analysis");
  if (!list || !analysis) return;
  list.innerHTML = foods.length ? foods.map((food, index) => `<div class="selected-food"><span><b>${food.name}</b><small>${food.unit}${food.estimated ? " · 估算" : ""}</small></span><span class="food-stepper"><button type="button" data-food-minus="${index}" aria-label="减少">−</button><b>${food.quantity}</b><button type="button" data-food-plus="${index}" aria-label="增加">＋</button></span><strong>${foodCalories(food)} kcal</strong><button class="remove-food" type="button" data-food-remove="${index}" aria-label="删除">×</button></div>`).join("") : `<div class="empty-selection">从上方选择食物，或输入你吃的具体内容</div>`;
  const summary = macroSummary(foods);
  analysis.innerHTML = foods.length ? `<div class="analysis-head"><span>本餐供能估算</span><strong>${summary.calories} kcal</strong></div><div class="macro-bar"><i style="width:${summary.carbsPercent}%"></i><i style="width:${summary.proteinPercent}%"></i><i style="width:${summary.fatPercent}%"></i></div><div class="macro-legend"><span><i class="dot dot-carbs"></i>碳水 ${summary.carbsPercent}%</span><span><i class="dot dot-protein"></i>蛋白质 ${summary.proteinPercent}%</span><span><i class="dot dot-fat"></i>脂肪 ${summary.fatPercent}%</span></div><p>按所选份量估算，仅用于观察饮食结构。</p>` : "";
  list.querySelectorAll("[data-food-minus]").forEach((button) => button.addEventListener("click", () => { const food = foods[Number(button.dataset.foodMinus)]; food.quantity = Math.max(.5, food.quantity - .5); renderMealSelection(foods); }));
  list.querySelectorAll("[data-food-plus]").forEach((button) => button.addEventListener("click", () => { foods[Number(button.dataset.foodPlus)].quantity += .5; renderMealSelection(foods); }));
  list.querySelectorAll("[data-food-remove]").forEach((button) => button.addEventListener("click", () => { foods.splice(Number(button.dataset.foodRemove), 1); renderMealSelection(foods); }));
}

function openModal(type) {
  const modal = document.querySelector("#modal-backdrop");
  const title = document.querySelector("#modal-title");
  const content = document.querySelector("#modal-content");
  const record = activeRecord();
  document.querySelector("#modal-close").hidden = false;
  document.querySelector("#modal-kicker").textContent = "QUICK RECORD";
  modal.hidden = false;
  if (type === "weight") {
    title.textContent = "记录体重";
    content.innerHTML = `<div class="field"><label>体重（kg）</label><input id="weight-input" inputmode="decimal" value="${record.weight}" /></div><div class="field"><label>体重照片（可选）</label><button class="choice-button" id="photo-button" type="button">拍照识别体重秤</button></div><button class="primary-button" id="save-weight">保存记录</button>`;
    document.querySelector("#photo-button").addEventListener("click", () => showToast("原型中将接入本地 OCR，识别后仍需确认"));
    document.querySelector("#save-weight").addEventListener("click", () => {
      const value = Number(document.querySelector("#weight-input").value);
      if (!value || value < 20 || value > 300) return showToast("请输入合理的体重数值");
      const store = activeProfileStore();
      const today = localDateKey();
      record.weight = value;
      record.weightRecorded = true;
      const existingHistory = store.weightHistory.find((item) => item.date === today);
      if (existingHistory) existingHistory.weight = value;
      else store.weightHistory.push({ date: today, weight: value });
      store.weightHistory.sort((a, b) => a.date.localeCompare(b.date));
      const recentWeights = store.weightHistory.slice(-7).map((item) => Number(item.weight));
      record.average = recentWeights.reduce((sum, weight) => sum + weight, 0) / recentWeights.length;
      saveState(); renderHome(); closeModal(); showToast("体重已记录");
    });
  }
  if (type === "water") {
    title.textContent = "补充饮水";
    let selectedDrink = drinkTypes[0];
    content.innerHTML = `<div class="field"><label>喝了什么？</label><div class="drink-grid">${drinkTypes.map((drink, index) => `<button class="drink-choice ${index === 0 ? "is-selected" : ""}" type="button" data-drink="${drink.id}"><span>${drink.icon}</span><b>${drink.name}</b></button>`).join("")}</div></div><div class="custom-drink-fields" id="custom-drink-fields" hidden><div class="field"><label>饮品名称</label><input id="custom-drink-name" maxlength="16" placeholder="例如：无糖豆浆" /></div><label class="check-row"><input id="custom-drink-counts" type="checkbox" checked /><span>计入今日饮水目标</span></label></div><div class="field"><label>喝了多少？</label><div class="water-choices"><button class="choice-button" data-ml="200">200 ml</button><button class="choice-button is-selected" data-ml="300">300 ml</button><button class="choice-button" data-ml="500">500 ml</button></div><input id="water-input" inputmode="numeric" value="300" placeholder="自定义容量（ml）" /></div><div class="drink-note" id="drink-note">白水将计入今日饮水目标</div><button class="primary-button" id="save-water">保存饮水</button>`;
    document.querySelectorAll("[data-drink]").forEach((button) => button.addEventListener("click", () => {
      selectedDrink = drinkTypes.find((drink) => drink.id === button.dataset.drink);
      document.querySelectorAll("[data-drink]").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      document.querySelector("#custom-drink-fields").hidden = selectedDrink.id !== "custom";
      document.querySelector("#drink-note").textContent = selectedDrink.id === "custom" ? "填写名称，并确认是否计入饮水目标" : selectedDrink.counts ? `${selectedDrink.name}将计入今日饮水目标` : `${selectedDrink.name}会保存记录，但不计入饮水目标`;
    }));
    document.querySelectorAll("[data-ml]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#water-input").value = button.dataset.ml; document.querySelectorAll("[data-ml]").forEach((item) => item.classList.remove("is-selected")); button.classList.add("is-selected"); }));
    document.querySelector("#save-water").addEventListener("click", () => {
      const value = Number(document.querySelector("#water-input").value);
      if (!value || value < 50) return showToast("请输入饮水量");
      let drink = selectedDrink;
      if (selectedDrink.id === "custom") {
        const name = document.querySelector("#custom-drink-name").value.trim();
        if (!name) return showToast("请填写饮品名称");
        drink = { id: "custom", name, counts: document.querySelector("#custom-drink-counts").checked };
      }
      record.waterLogs.push({ type: drink.id, name: drink.name, amount: value, counts: drink.counts, createdAt: new Date().toISOString() });
      if (drink.counts) record.water += value;
      saveState(); renderHome(); closeModal(); showToast(`已记录 ${value} ml ${drink.name}`);
    });
  }
  if (type === "meal") {
    title.textContent = "记录一餐";
    const selectedFoods = [];
    content.innerHTML = `<div class="field"><label>餐次</label><select id="meal-time"><option>早餐</option><option selected>午餐</option><option>晚餐</option><option>加餐</option></select></div><div class="field"><label>常见食物 · 点击添加一份</label><div class="food-grid">${commonFoods.map((food) => `<button class="food-choice" type="button" data-food="${food.id}"><b>${food.name}</b><small>${food.unit}</small></button>`).join("")}</div></div><div class="field"><label>没有找到？直接输入食物名称</label><div class="custom-food-row"><input id="custom-food-input" placeholder="例如：番茄牛肉盖饭" /><button type="button" id="add-custom-food">添加</button></div></div><div class="field"><label>本餐已选</label><div id="selected-foods"></div></div><div class="meal-analysis" id="meal-analysis"></div><button class="primary-button" id="save-meal">保存本餐</button>`;
    document.querySelectorAll("[data-food]").forEach((button) => button.addEventListener("click", () => {
      const food = commonFoods.find((item) => item.id === button.dataset.food);
      const existing = selectedFoods.find((item) => item.id === food.id);
      if (existing) existing.quantity += 1;
      else selectedFoods.push({ ...food, quantity: 1 });
      renderMealSelection(selectedFoods);
    }));
    document.querySelector("#add-custom-food").addEventListener("click", () => {
      const input = document.querySelector("#custom-food-input");
      const name = input.value.trim();
      if (!name) return showToast("请输入食物名称");
      selectedFoods.push({ ...estimateCustomFood(name), quantity: 1 });
      input.value = "";
      renderMealSelection(selectedFoods);
    });
    renderMealSelection(selectedFoods);
    document.querySelector("#save-meal").addEventListener("click", () => {
      if (!selectedFoods.length) return showToast("请至少添加一种食物");
      const mealTime = document.querySelector("#meal-time").value;
      record.mealRecords.push({ mealTime, foods: selectedFoods, summary: macroSummary(selectedFoods), createdAt: new Date().toISOString() });
      record.meal = true;
      saveState(); renderHome(); closeModal(); showToast(`${mealTime}已保存并完成营养估算`);
    });
  }
  if (type === "sleep") {
    title.textContent = "记录睡眠";
    content.innerHTML = `<div class="form-row"><div class="field"><label>入睡时间</label><input id="sleep-start" type="time" value="23:20" /></div><div class="field"><label>起床时间</label><input id="sleep-end" type="time" value="06:44" /></div></div><div class="field"><label>主观感受</label><select id="sleep-quality"><option>一般</option><option>好</option><option>差</option></select></div><button class="primary-button" id="save-sleep">保存记录</button>`;
    document.querySelector("#save-sleep").addEventListener("click", () => {
      const start = document.querySelector("#sleep-start").value;
      const end = document.querySelector("#sleep-end").value;
      if (!start || !end) return showToast("请填写入睡和起床时间");
      record.sleep = sleepDuration(start, end);
      saveState(); renderHome(); closeModal(); showToast("睡眠已记录，建议已更新");
    });
  }
}

function openProfiles() {
  const modal = document.querySelector("#modal-backdrop");
  const current = activeProfile();
  if (!current) {
    openCreateProfile();
    return;
  }
  document.querySelector("#modal-close").hidden = false;
  document.querySelector("#modal-title").textContent = "切换档案";
  document.querySelector("#modal-kicker").textContent = "LOCAL PROFILES";
  const backupText = state.lastBackupAt ? `上次备份：${new Date(state.lastBackupAt).toLocaleDateString("zh-CN")}` : "尚未备份，建议每周导出一次";
  document.querySelector("#modal-content").innerHTML = `<div class="goal-summary"><span><small>当前目标</small><strong>${current.targetWeight} kg · ${current.planWeeks} 周计划</strong></span><button type="button" id="edit-goal">调整</button></div><div class="personal-settings"><button type="button" id="choose-avatar"><span class="personal-preview avatar-preview ${current.avatarData ? "has-image" : ""}" ${current.avatarData ? `style="background-image:url(${current.avatarData})"` : ""}>${current.avatarData ? "" : current.initial}</span><b>更换头像</b><small>方形图片效果最佳</small></button><button type="button" id="choose-dashboard"><span class="personal-preview dashboard-preview ${current.dashboardBackground ? "has-image" : ""}" ${current.dashboardBackground ? `style="background-image:url(${current.dashboardBackground})"` : ""}>▣</span><b>看板背景</b><small>横向图片效果最佳</small></button><input id="avatar-file" type="file" accept="image/*" hidden /><input id="dashboard-file" type="file" accept="image/*" hidden /></div><div class="profile-list">${state.profiles.map((profile) => `<button class="profile-item ${profile.id === state.activeProfile ? "is-current" : ""}" data-profile="${profile.id}"><span class="avatar avatar-${profile.color === "mint" ? "mint" : "coral"} ${profile.avatarData ? "has-image" : ""}" ${profile.avatarData ? `style="background-image:url(${profile.avatarData})"` : ""}>${profile.avatarData ? "" : profile.initial}</span><span><strong>${profile.name}</strong><small>${profile.id === state.activeProfile ? "当前档案" : "本机独立数据"}</small></span><span class="profile-lock">⌑</span></button>`).join("")}</div><button class="primary-button" id="add-profile">＋ 新建本地档案</button><section class="data-tools"><div><b>数据与设备</b><small>${backupText}</small></div><div class="data-tool-grid"><button type="button" id="install-app">安装到手机</button><button type="button" id="export-backup">导出备份</button><button type="button" id="import-backup">恢复备份</button>${isLocalPreview() ? `<button type="button" id="migrate-live">迁移到正式版</button>` : ""}</div><p>备份包含所有档案、记录、头像和背景图，请妥善保管。</p><input id="backup-file" type="file" accept="application/json,.json" hidden /></section>`;
  modal.hidden = false;
  document.querySelectorAll("[data-profile]").forEach((button) => button.addEventListener("click", () => {
    const selected = state.profiles.find((profile) => profile.id === button.dataset.profile);
    if (selected.id === state.activeProfile) return closeModal();
    openPinEntry(selected);
  }));
  document.querySelector("#choose-avatar").addEventListener("click", () => document.querySelector("#avatar-file").click());
  document.querySelector("#choose-dashboard").addEventListener("click", () => document.querySelector("#dashboard-file").click());
  document.querySelector("#avatar-file").addEventListener("change", async (event) => {
    try {
      current.avatarData = await compressImage(event.target.files[0], 256, 256, .8);
      if (!saveState()) return;
      renderHome(); openProfiles(); showToast("头像已更新");
    } catch (error) { showToast(error.message); }
  });
  document.querySelector("#dashboard-file").addEventListener("change", async (event) => {
    try {
      current.dashboardBackground = await compressImage(event.target.files[0], 1200, 700, .72);
      if (!saveState()) return;
      renderHome(); openProfiles(); showToast("今日看板背景已更新");
    } catch (error) { showToast(error.message); }
  });
  document.querySelector("#edit-goal").addEventListener("click", openGoalEditor);
  document.querySelector("#add-profile").addEventListener("click", openCreateProfile);
  document.querySelector("#install-app").addEventListener("click", installApp);
  document.querySelector("#export-backup").addEventListener("click", exportBackup);
  document.querySelector("#import-backup").addEventListener("click", () => document.querySelector("#backup-file").click());
  document.querySelector("#backup-file").addEventListener("change", (event) => prepareImport(event.target.files[0]));
  document.querySelector("#migrate-live")?.addEventListener("click", migrateToLiveApp);
}

function openPinEntry(profile) {
  document.querySelector("#modal-title").textContent = `进入${profile.name}`;
  document.querySelector("#modal-kicker").textContent = "PROFILE LOCK";
  document.querySelector("#modal-content").innerHTML = `<div class="field"><label>输入 4～6 位 PIN</label><input id="switch-pin" inputmode="numeric" maxlength="6" type="password" autofocus /></div><button class="primary-button" id="confirm-switch">验证并进入</button>`;
  document.querySelector("#confirm-switch").addEventListener("click", () => {
    const pin = document.querySelector("#switch-pin").value;
    if (pin !== profile.pin) return showToast("PIN 不正确，档案未切换");
    state.activeProfile = profile.id;
    saveState(); renderHome(); closeModal(); showToast(`已切换到${profile.name}`);
  });
}

function openGoalEditor() {
  const profile = activeProfile();
  const record = activeRecord();
  document.querySelector("#modal-title").textContent = "调整减脂目标";
  document.querySelector("#modal-kicker").textContent = "YOUR PLAN";
  document.querySelector("#modal-content").innerHTML = `<div class="goal-explainer">以下信息用于估算基础代谢和日常消耗。建议减脂速度通常不超过每周体重的 1%。</div><div class="form-row"><div class="field"><label>生理性别</label><select id="goal-sex"><option value="female" ${profile.sex === "female" ? "selected" : ""}>女</option><option value="male" ${profile.sex === "male" ? "selected" : ""}>男</option></select></div><div class="field"><label>年龄</label><input id="goal-age" inputmode="numeric" value="${profile.age || ""}" placeholder="岁" /></div></div><div class="form-row"><div class="field"><label>身高（cm）</label><input id="goal-height" inputmode="decimal" value="${profile.height || ""}" /></div><div class="field"><label>活动水平</label><select id="goal-activity">${activityOptions(profile.activity)}</select></div></div><div class="form-row"><div class="field"><label>当前体重（kg）</label><input id="goal-current-weight" inputmode="decimal" value="${record.weight}" /></div><div class="field"><label>目标体重（kg）</label><input id="goal-target-weight" inputmode="decimal" value="${profile.targetWeight}" /></div></div><div class="field"><label>计划周期（周）</label><input id="goal-weeks" inputmode="numeric" value="${profile.planWeeks}" /></div><button class="primary-button" id="save-goal">保存资料并更新建议</button>`;
  document.querySelector("#save-goal").addEventListener("click", () => {
    const sex = document.querySelector("#goal-sex").value;
    const age = Number(document.querySelector("#goal-age").value);
    const height = Number(document.querySelector("#goal-height").value);
    const activity = Number(document.querySelector("#goal-activity").value);
    const currentWeight = Number(document.querySelector("#goal-current-weight").value);
    const targetWeight = Number(document.querySelector("#goal-target-weight").value);
    const planWeeks = Number(document.querySelector("#goal-weeks").value);
    if (!age || age < 18 || age > 80) return showToast("年龄请输入 18～80 岁");
    if (!height || height < 120 || height > 220) return showToast("请输入合理的身高");
    if (!currentWeight || !targetWeight || targetWeight >= currentWeight) return showToast("目标体重需要低于当前体重");
    if (!planWeeks || planWeeks < 2 || planWeeks > 104) return showToast("计划周期请输入 2～104 周");
    profile.sex = sex;
    profile.age = age;
    profile.height = height;
    profile.activity = activity;
    record.weight = currentWeight;
    record.weightRecorded = true;
    const store = activeProfileStore();
    const today = localDateKey();
    const todayWeight = store.weightHistory.find((item) => item.date === today);
    if (todayWeight) todayWeight.weight = currentWeight;
    else store.weightHistory.push({ date: today, weight: currentWeight });
    profile.startWeight = currentWeight;
    profile.targetWeight = targetWeight;
    profile.planWeeks = planWeeks;
    profile.startedAt = new Date().toISOString().slice(0, 10);
    currentAdvice = 0;
    saveState(); renderHome(); closeModal(); showToast("目标已更新，今日建议已重新生成");
  });
}

function openCreateProfile() {
  const isFirstProfile = state.profiles.length === 0;
  document.querySelector("#modal-backdrop").hidden = false;
  document.querySelector("#modal-close").hidden = isFirstProfile;
  document.querySelector("#modal-title").textContent = "新建本地档案";
  document.querySelector("#modal-kicker").textContent = "PRIVATE ON THIS DEVICE";
  document.querySelector("#modal-content").innerHTML = `<div class="field"><label>昵称</label><input id="profile-name-input" maxlength="8" placeholder="怎么称呼你" /></div><div class="form-row"><div class="field"><label>生理性别</label><select id="profile-sex"><option value="female">女</option><option value="male">男</option></select></div><div class="field"><label>年龄</label><input id="profile-age" inputmode="numeric" placeholder="岁" /></div></div><div class="form-row"><div class="field"><label>身高（cm）</label><input id="profile-height" inputmode="decimal" placeholder="例如 165" /></div><div class="field"><label>活动水平</label><select id="profile-activity">${activityOptions(1.375)}</select></div></div><div class="form-row"><div class="field"><label>当前体重（kg）</label><input id="profile-weight-input" inputmode="decimal" placeholder="例如 65.0" /></div><div class="field"><label>目标体重（kg）</label><input id="profile-target-input" inputmode="decimal" placeholder="例如 58.0" /></div></div><div class="form-row"><div class="field"><label>计划周期（周）</label><input id="profile-weeks-input" inputmode="numeric" placeholder="例如 16" /></div><div class="field"><label>4～6 位 PIN</label><input id="profile-pin-input" inputmode="numeric" maxlength="6" type="password" placeholder="保护隐私" /></div></div><div class="goal-explainer">保存后，饮食、睡眠和体重建议会按照目标速度动态调整。</div><button class="primary-button" id="save-profile">创建并进入档案</button>${isFirstProfile ? `<div class="first-use-restore"><span>已经在旧版本使用过？</span><button class="secondary-button" type="button" id="restore-first-backup">恢复已有备份</button><input id="first-backup-file" type="file" accept="application/json,.json" hidden /></div>` : ""}`;
  document.querySelector("#save-profile").addEventListener("click", () => {
    const name = document.querySelector("#profile-name-input").value.trim();
    const sex = document.querySelector("#profile-sex").value;
    const age = Number(document.querySelector("#profile-age").value);
    const height = Number(document.querySelector("#profile-height").value);
    const activity = Number(document.querySelector("#profile-activity").value);
    const weight = Number(document.querySelector("#profile-weight-input").value);
    const targetWeight = Number(document.querySelector("#profile-target-input").value);
    const planWeeks = Number(document.querySelector("#profile-weeks-input").value);
    const pin = document.querySelector("#profile-pin-input").value.trim();
    if (!name) return showToast("请填写昵称");
    if (!age || age < 18 || age > 80) return showToast("年龄请输入 18～80 岁");
    if (!height || height < 120 || height > 220) return showToast("请输入合理的身高");
    if (!weight || weight < 20 || weight > 300) return showToast("请输入合理的体重");
    if (!targetWeight || targetWeight >= weight) return showToast("目标体重需要低于当前体重");
    if (!planWeeks || planWeeks < 2 || planWeeks > 104) return showToast("计划周期请输入 2～104 周");
    if (!/^\d{4,6}$/.test(pin)) return showToast("PIN 需要是 4～6 位数字");
    const id = `profile-${Date.now()}`;
    state.profiles.push({ id, name, initial: name.slice(0, 1), color: state.profiles.length % 2 ? "coral" : "mint", pin, sex, age, height, activity, startWeight: weight, targetWeight, planWeeks, startedAt: new Date().toISOString().slice(0, 10) });
    state.records[id] = {
      days: { [localDateKey()]: { ...emptyDailyRecord(weight), weightRecorded: true } },
      weightHistory: [{ date: localDateKey(), weight }]
    };
    state.activeProfile = id;
    document.querySelector("#modal-close").hidden = false;
    saveState(); renderHome(); closeModal(); showToast(`“${name}”档案已创建`);
  });
  if (isFirstProfile) {
    document.querySelector("#restore-first-backup").addEventListener("click", () => document.querySelector("#first-backup-file").click());
    document.querySelector("#first-backup-file").addEventListener("change", (event) => prepareImport(event.target.files[0]));
  }
}

function setNavigation(tab) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.tab === tab));
}

function showAppView(view) {
  if (!activeProfile()) return openCreateProfile();
  currentView = view;
  document.querySelector("#home-view").hidden = view !== "home";
  document.querySelector("#trend-view").hidden = view !== "trend";
  setNavigation(view);
  if (view === "trend") renderTrend();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLockScreen() {
  if (!state.profiles.length) return;
  const select = document.querySelector("#lock-profile");
  select.innerHTML = state.profiles.map((profile) => `<option value="${profile.id}" ${profile.id === state.activeProfile ? "selected" : ""}>${profile.name}</option>`).join("");
  document.querySelector("#lock-pin").value = "";
  document.querySelector("#lock-error").textContent = "";
  document.querySelector("#modal-backdrop").hidden = true;
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#app-lock").hidden = false;
  window.setTimeout(() => document.querySelector("#lock-pin").focus(), 50);
}

function unlockApp() {
  const profile = state.profiles.find((item) => item.id === document.querySelector("#lock-profile").value);
  const pin = document.querySelector("#lock-pin").value.trim();
  if (!profile || pin !== profile.pin) {
    document.querySelector("#lock-error").textContent = "访问密码不正确";
    document.querySelector("#lock-pin").select();
    return;
  }
  state.activeProfile = profile.id;
  saveState();
  document.querySelector("#app-lock").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  currentView = "home";
  renderDate();
  renderHome();
  showAppView("home");
}

function closeModal() {
  document.querySelector("#modal-backdrop").hidden = true;
  setNavigation(currentView);
}
function rotateAdvice() { currentAdvice = (currentAdvice + 1) % goalAdvice().length; renderGoalAdvice(); }

document.querySelectorAll("[data-record]").forEach((button) => button.addEventListener("click", () => openModal(button.dataset.record)));
document.querySelector("#profile-trigger").addEventListener("click", openProfiles);
document.querySelector("#modal-close").addEventListener("click", closeModal);
document.querySelector("#modal-backdrop").addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); });
document.querySelector("#refresh-advice").addEventListener("click", rotateAdvice);
document.querySelector("#complete-calorie-profile").addEventListener("click", () => { document.querySelector("#modal-backdrop").hidden = false; openGoalEditor(); });
document.querySelector("#advice-done").addEventListener("click", (event) => { event.currentTarget.classList.toggle("is-done"); showToast(event.currentTarget.classList.contains("is-done") ? "建议已完成" : "已恢复待办"); });
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
  const tab = button.dataset.tab;
  if (tab === "home" || tab === "trend") return showAppView(tab);
  setNavigation(tab);
  if (tab === "records") openModal("meal");
  if (tab === "profile") openProfiles();
}));
document.querySelectorAll("[data-trend-range]").forEach((button) => button.addEventListener("click", () => {
  trendRange = Number(button.dataset.trendRange);
  renderTrend();
}));
document.querySelector("#unlock-app").addEventListener("click", unlockApp);
document.querySelector("#lock-pin").addEventListener("keydown", (event) => { if (event.key === "Enter") unlockApp(); });
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showToast("sherry的掉秤日记已安装到桌面");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  renderDate();
  if (hiddenAt && Date.now() - hiddenAt >= 2 * 60 * 1000) showLockScreen();
});

renderDate();
if (state.profiles.length) {
  showLockScreen();
} else {
  document.querySelector("#app-lock").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  openCreateProfile();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
