/* 界书 · 世界与人设 */
(function () {
  "use strict";

  var STORAGE_KEY = "jieshu.data.v1";
  var GENDERS = ["男", "女", "双性", "无性"];
  var TONE_CLASSES = ["tone-0", "tone-1", "tone-2", "tone-3", "tone-4"];
  var BUILTIN_MODELS = {
    deepseek: [
      {
        id: "deepseek-flash",
        name: "DeepSeek-V4.1-Flash",
        version: "V4.1-Flash-1017",
        latest: true
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek-V4-Pro",
        version: "V4-Pro-0813"
      }
    ],
    qwen: [
      { id: "qwen3.8-max", name: "通义千问3.8-Max", latest: true },
      { id: "qwen3.8-flash", name: "通义千问3.8-Flash" },
      { id: "qwen3.7-plus", name: "通义千问3.7-Plus" }
    ]
  };
  var LEGACY_MODEL_MAP = {
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
    "qwen-plus": "qwen3.8-max",
    "qwen-max": "qwen3.8-max",
    "qwen-turbo": "qwen3.8-flash"
  };
  var AI_PRESETS = {
    deepseek: {
      label: "DeepSeek",
      url: "https://api.deepseek.com",
      model: "deepseek-flash",
      modelName: "DeepSeek-V4.1-Flash"
    },
    qwen: {
      label: "通义千问",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.8-max",
      modelName: "通义千问3.8-Max"
    }
  };
  var DEFAULT_AI = {
    provider: "deepseek",
    url: AI_PRESETS.deepseek.url,
    model: AI_PRESETS.deepseek.model,
    modelName: AI_PRESETS.deepseek.modelName,
    key: "",
    models: BUILTIN_MODELS.deepseek.slice(),
    detectedAt: 0,
    manualModel: false
  };

  var $ = function (selector, root) {
    return (root || document).querySelector(selector);
  };
  var $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  var db = loadData();
  var currentWorldId = null;
  var openNpcIds = new Set();
  var activeTab = "worlds";
  var saveTimer = null;
  var toastTimer = null;
  var selectionMode = false;
  var selectedWorldIds = new Set();
  var settingsReturn = "worlds";
  var aiBusy = false;
  var aiBackgroundWait = false;
  var aiTaskInfo = { label: "AI 正在生成", doneTitle: "界书 · AI 已完成" };
  var activeAIRequestId = null;
  var modelDiscoveryBusy = false;
  var aiRequests = {};
  var aiRequestSeq = 0;
  var pressTimer = null;
  var pressStart = null;
  var suppressClickUntil = 0;
  var suppressClickWorldId = null;

  /* ---------------- 数据与存储 ---------------- */

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function readStored() {
    var raw = "";
    try {
      if (window.AndroidStore && typeof window.AndroidStore.load === "function") {
        raw = window.AndroidStore.load() || "";
      }
    } catch (err) {
      raw = "";
    }
    if (!raw) {
      try {
        raw = localStorage.getItem(STORAGE_KEY) || "";
      } catch (err) {
        raw = "";
      }
    }
    return raw;
  }

  function writeStored(raw) {
    var ok = false;
    try {
      if (window.AndroidStore && typeof window.AndroidStore.save === "function") {
        window.AndroidStore.save(raw);
        ok = true;
      }
    } catch (err) {
      ok = false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      ok = true;
    } catch (err) {
      /* 本地存储不可用时，仍可能由原生存储保存 */
    }
    return ok;
  }

  function normalize(raw) {
    var data = raw && typeof raw === "object" ? raw : {};
    var worlds = Array.isArray(data.worlds) ? data.worlds : [];
    var personas = Array.isArray(data.personas) ? data.personas : [];
    var groups = (Array.isArray(data.groups) ? data.groups : [])
      .filter(function (group) {
        return group && typeof group === "object";
      })
      .map(function (group) {
        return {
          id: typeof group.id === "string" ? group.id : uid("g"),
          name: typeof group.name === "string" ? group.name : "未命名组",
          collapsed: group.collapsed === true,
          createdAt: Number(group.createdAt) || Date.now()
        };
      });
    var groupIds = groups.map(function (group) {
      return group.id;
    });
    var aiRaw =
      data.settings && data.settings.ai && typeof data.settings.ai === "object"
        ? data.settings.ai
        : {};
    var aiProvider =
      typeof aiRaw.provider === "string" ? aiRaw.provider : DEFAULT_AI.provider;
    var aiUrl = typeof aiRaw.url === "string" ? aiRaw.url : DEFAULT_AI.url;
    var aiModels = normalizeModelCatalog(aiRaw.models, aiProvider);
    if (!aiModels.length) aiModels = builtinModels(aiProvider).slice();
    var aiModel =
      typeof aiRaw.model === "string" && aiRaw.model ? aiRaw.model : DEFAULT_AI.model;
    var aiManualModel = aiRaw.manualModel === true;
    var migratedModel = LEGACY_MODEL_MAP[aiModel];
    if (migratedModel && !aiManualModel) {
      aiModel = migratedModel;
    }
    var aiModelName =
      typeof aiRaw.modelName === "string" ? aiRaw.modelName : "";
    if (migratedModel && !aiManualModel) aiModelName = "";
    if (!aiModelName) {
      aiModelName = resolveModelName(aiModel, aiModels, aiProvider);
    }
    var backgroundRaw =
      data.settings && data.settings.background
        ? data.settings.background
        : null;
    var background = {
      dataUrl:
        typeof backgroundRaw === "string"
          ? backgroundRaw
          : backgroundRaw && typeof backgroundRaw.dataUrl === "string"
            ? backgroundRaw.dataUrl
            : "",
      name:
        backgroundRaw && typeof backgroundRaw.name === "string"
          ? backgroundRaw.name
          : ""
    };
    var ai = {
      provider: aiProvider,
      url: aiUrl,
      model: aiModel,
      modelName: aiModelName,
      key: typeof aiRaw.key === "string" ? aiRaw.key : "",
      models: aiModels,
      detectedAt: Number(aiRaw.detectedAt) || 0,
      manualModel: aiManualModel
    };

    return {
      worlds: worlds
        .filter(function (world) {
          return world && typeof world === "object";
        })
        .map(function (world) {
          var npcs = Array.isArray(world.npcs) ? world.npcs : [];
          var rules = Array.isArray(world.rules) ? world.rules : [];
          var fusedFrom = Array.isArray(world.fusedFrom)
            ? world.fusedFrom.filter(function (id) {
                return typeof id === "string";
              })
            : [];
          return {
            id: typeof world.id === "string" ? world.id : uid("w"),
            name: typeof world.name === "string" ? world.name : "",
            description:
              typeof world.description === "string" ? world.description : "",
            region: typeof world.region === "string" ? world.region : "",
            currency: typeof world.currency === "string" ? world.currency : "",
            groupId:
              typeof world.groupId === "string" &&
              groupIds.indexOf(world.groupId) >= 0
                ? world.groupId
                : null,
            sourcePrompt:
              typeof world.sourcePrompt === "string" ? world.sourcePrompt : "",
            fusedFrom: fusedFrom,
            npcs: npcs
              .filter(function (npc) {
                return npc && typeof npc === "object";
              })
              .map(function (npc) {
                return {
                  id: typeof npc.id === "string" ? npc.id : uid("n"),
                  name: typeof npc.name === "string" ? npc.name : "",
                  age: typeof npc.age === "string" ? npc.age : String(npc.age || ""),
                  gender:
                    GENDERS.indexOf(npc.gender) >= 0 ? npc.gender : "男",
                  persona: typeof npc.persona === "string" ? npc.persona : ""
                };
              }),
            rules: rules
              .filter(function (rule) {
                return rule && typeof rule === "object";
              })
              .map(function (rule) {
                return {
                  id: typeof rule.id === "string" ? rule.id : uid("r"),
                  title: typeof rule.title === "string" ? rule.title : "",
                  content:
                    typeof rule.content === "string" ? rule.content : ""
                };
              }),
            createdAt: Number(world.createdAt) || Date.now(),
            updatedAt: Number(world.updatedAt) || Date.now()
          };
        }),
      groups: groups,
      conversations: normalizeConversations(data.conversations),
      chatGroups: normalizeChatGroups(data.chatGroups),
      chatSettings: normalizeChatSettings(data.chatSettings),
      settings: { ai: ai, background: background },
      personas: personas
        .filter(function (persona) {
          return persona && typeof persona === "object";
        })
        .map(function (persona) {
          return {
            id: typeof persona.id === "string" ? persona.id : uid("p"),
            type: persona.type === "npc" ? "npc" : "user",
            name: typeof persona.name === "string" ? persona.name : "",
            age: typeof persona.age === "string" ? persona.age : String(persona.age || ""),
            gender:
              GENDERS.indexOf(persona.gender) >= 0
                ? persona.gender
                : persona.gender === ""
                ? ""
                : "女",
            height: typeof persona.height === "string" ? persona.height : String(persona.height || ""),
            weight: typeof persona.weight === "string" ? persona.weight : String(persona.weight || ""),
            appearance: typeof persona.appearance === "string" ? persona.appearance : "",
            personality: typeof persona.personality === "string" ? persona.personality : "",
            figure: typeof persona.figure === "string" ? persona.figure : "",
            abilities: normalizeAbilityList(persona.abilities),
            inner: typeof persona.inner === "string" ? persona.inner : "",
            history: typeof persona.history === "string" ? persona.history : "",
            persona: typeof persona.persona === "string" ? persona.persona : "",
            createdAt: Number(persona.createdAt) || Date.now(),
            updatedAt: Number(persona.updatedAt) || Date.now()
          };
        })
    };
  }

  function loadData() {
    var raw = readStored();
    if (!raw) {
      return normalize({});
    }
    try {
      return normalize(JSON.parse(raw));
    } catch (err) {
      return normalize({});
    }
  }

  function builtinModels(provider) {
    var list = BUILTIN_MODELS[provider] || [];
    return list.map(function (model) {
      return {
        id: model.id,
        name: model.name,
        version: model.version || "",
        latest: !!model.latest,
        created: 0
      };
    });
  }

  function normalizeModelCatalog(list, provider) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var result = [];
    list.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var id = stringValue(item.id || item.model || item.model_id);
      if (!id || seen[id]) return;
      seen[id] = true;
      var created = Number(item.created) || 0;
      if (!created && item.published_time) {
        created = Date.parse(String(item.published_time).replace(" ", "T")) || 0;
      }
      result.push({
        id: id,
        name: stringValue(item.name || item.display_name || item.displayName) || "",
        version: stringValue(item.version || item.model_version || ""),
        latest: item.latest === true,
        created: created
      });
    });
    return result;
  }

  function formatModelName(id) {
    var value = String(id || "").trim();
    if (!value) return "";
    if (/[\u4e00-\u9fff]/.test(value)) return value;
    var known = {
      deepseek: "DeepSeek",
      qwen: "Qwen",
      flash: "Flash",
      pro: "Pro",
      max: "Max",
      plus: "Plus",
      turbo: "Turbo",
      mini: "Mini",
      chat: "Chat",
      reasoner: "Reasoner",
      v: "V"
    };
    return value
      .split(/[-_/]+/)
      .map(function (part) {
        var lower = part.toLowerCase();
        if (known[lower]) return known[lower];
        if (/^v\d/i.test(part)) return part.toUpperCase();
        if (/^\d/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function resolveModelName(id, models, provider) {
    var value = String(id || "").trim();
    if (!value) return "";
    var pools = [];
    if (Array.isArray(models)) pools = pools.concat(models);
    pools = pools.concat(builtinModels(provider));
    for (var i = 0; i < pools.length; i += 1) {
      if (pools[i].id === value && pools[i].name) return pools[i].name;
    }
    return formatModelName(value);
  }

  function isDeprecatedModel(id) {
    return Object.prototype.hasOwnProperty.call(LEGACY_MODEL_MAP, id);
  }

  function modelVersionScore(model) {
    var text = String((model && model.name) || "") + " " + String((model && model.id) || "");
    var matches = text.match(/\d+(?:\.\d+)+/g);
    var best = 0;
    if (!matches) return best;
    matches.forEach(function (value) {
      var number = parseFloat(value);
      if (number > best) best = number;
    });
    return best;
  }

  function currentWorld() {
    if (!currentWorldId) return null;
    for (var i = 0; i < db.worlds.length; i += 1) {
      if (db.worlds[i].id === currentWorldId) return db.worlds[i];
    }
    return null;
  }

  function findNpc(world, id) {
    if (!world) return null;
    for (var i = 0; i < world.npcs.length; i += 1) {
      if (world.npcs[i].id === id) return world.npcs[i];
    }
    return null;
  }

  function findRule(world, id) {
    if (!world) return null;
    for (var i = 0; i < world.rules.length; i += 1) {
      if (world.rules[i].id === id) return world.rules[i];
    }
    return null;
  }

  function findWorld(id) {
    for (var i = 0; i < db.worlds.length; i += 1) {
      if (db.worlds[i].id === id) return db.worlds[i];
    }
    return null;
  }

  function findGroup(id) {
    for (var i = 0; i < db.groups.length; i += 1) {
      if (db.groups[i].id === id) return db.groups[i];
    }
    return null;
  }

  function worldIsReady(world) {
    if (!world || !world.name || !world.name.trim()) return false;
    return !!(
      (world.description && world.description.trim()) ||
      (world.region && world.region.trim()) ||
      (world.currency && world.currency.trim()) ||
      (world.npcs && world.npcs.length) ||
      (world.rules && world.rules.length)
    );
  }

  function readyWorldCount() {
    var count = 0;
    db.worlds.forEach(function (world) {
      if (worldIsReady(world)) count += 1;
    });
    return count;
  }

  function aiConfig() {
    return (db.settings && db.settings.ai) || DEFAULT_AI;
  }

  function isAIConfigured() {
    var ai = aiConfig();
    return !!(ai.url && ai.url.trim() && ai.key && ai.key.trim() && ai.model && ai.model.trim());
  }

  function touch(world) {
    if (world) world.updatedAt = Date.now();
  }

  function setSaveState(state) {
    var el = $("#save-state");
    if (!el) return;
    el.classList.toggle("saving", state === "saving");
    el.classList.toggle("error", state === "error");
    if (state === "saving") {
      el.innerHTML = "<i></i>保存中…";
    } else if (state === "error") {
      el.innerHTML = "<i></i>本地保存失败";
    } else {
      el.innerHTML = "<i></i>已自动保存";
    }
  }

  function persist(immediate) {
    setSaveState("saving");
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    var write = function () {
      var ok = writeStored(JSON.stringify(db));
      saveTimer = null;
      setSaveState(ok ? "saved" : "error");
      if (!ok) showToast("本地保存失败，请检查应用存储空间");
    };
    if (immediate) {
      write();
    } else {
      saveTimer = setTimeout(write, 320);
    }
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      writeStored(JSON.stringify(db));
    } catch (err) {
      /* 静默处理，页面即将离开 */
    }
  }

  /* ---------------- 工具 ---------------- */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function displayWorldName(world) {
    var name = world && world.name ? world.name.trim() : "";
    return name || "未命名世界";
  }

  function displayNpcName(npc) {
    var name = npc && npc.name ? npc.name.trim() : "";
    return name || "未命名角色";
  }

  function firstChar(value, fallback) {
    var text = String(value || "").trim();
    if (!text) return fallback || "?";
    var chars = Array.from(text);
    return chars[0] || fallback || "?";
  }

  function toneFor(id) {
    var hash = 0;
    var text = String(id || "");
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return TONE_CLASSES[hash % TONE_CLASSES.length];
  }

  function npcMeta(npc) {
    var parts = [];
    if (npc.age && npc.age.trim()) parts.push(npc.age.trim() + " 岁");
    if (npc.gender) parts.push(npc.gender);
    return parts.join(" · ") || "尚未填写";
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = "auto";
    var height = el.scrollHeight;
    var max = el.classList.contains("rule-content") ? 240 : 340;
    if (height > max) {
      el.style.height = max + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = height + "px";
      el.style.overflowY = "hidden";
    }
  }

  function maybeGrow(target) {
    if (target && target.classList.contains("text-area")) autoGrow(target);
  }

  function scrollEditorTo(el, center) {
    var scroller = $("#editor-scroll");
    if (!scroller || !el) return;
    var elRect = el.getBoundingClientRect();
    var scrollRect = scroller.getBoundingClientRect();
    var offset = 14;
    if (center) {
      offset = Math.max(14, (scroller.clientHeight - elRect.height) / 2);
    }
    var target = scroller.scrollTop + (elRect.top - scrollRect.top) - offset;
    target = Math.max(0, target);
    try {
      scroller.scrollTo({ top: target, behavior: "smooth" });
    } catch (err) {
      scroller.scrollTop = target;
    }
  }

  function ensureEditorVisible(el) {
    var scroller = $("#editor-scroll");
    if (!scroller || !el) return;
    var elRect = el.getBoundingClientRect();
    var scrollRect = scroller.getBoundingClientRect();
    var padding = 14;
    if (elRect.bottom > scrollRect.bottom - padding) {
      scroller.scrollTop += elRect.bottom - (scrollRect.bottom - padding);
    } else if (elRect.top < scrollRect.top + padding) {
      scroller.scrollTop -= scrollRect.top + padding - elRect.top;
    }
  }

  function showToast(message) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2400);
  }

  function setTabUI(tab) {
    activeTab = tab;
    $$(".tab").forEach(function (button) {
      var isActive = button.dataset.tab === tab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function showScreen(name) {
    $$(".screen").forEach(function (screen) {
      screen.classList.toggle("active", screen.id === "view-" + name);
    });
    var tabbar = $("#tabbar");
    if (
      name === "editor" ||
      name === "settings" ||
      name === "guide" ||
      name === "persona-edit" ||
      name === "chat" ||
      name === "chat-settings" ||
      selectionMode
    ) {
      tabbar.classList.add("hidden");
    } else {
      tabbar.classList.remove("hidden");
    }
    var selectionBar = $("#selection-bar");
    if (selectionBar && name !== "worlds") {
      selectionBar.classList.remove("visible");
    }
  }

  /* ---------------- 新手指南 ---------------- */

  var GUIDE_SEEN_KEY = "jieshu.guide.seen";

  function guideSeen() {
    try {
      return localStorage.getItem(GUIDE_SEEN_KEY) === "1";
    } catch (e) {
      return true;
    }
  }

  function markGuideSeen() {
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, "1");
    } catch (e) {}
    var entry = $("#open-guide");
    if (entry) entry.classList.remove("is-new");
    var badge = $("#guide-badge");
    if (badge) badge.classList.add("hidden");
  }

  function openGuide() {
    if (selectionMode) exitSelection();
    showScreen("guide");
    setTabUI("worlds");
    var scroller = $(".guide-scroll");
    if (scroller) scroller.scrollTop = 0;
    markGuideSeen();
  }

  function closeGuide() {
    showScreen("worlds");
    setTabUI("worlds");
    var worlds = $("#view-worlds");
    if (worlds) {
      var bar = $(".topbar", worlds);
      if (bar) bar.classList.toggle("is-stuck", worlds.scrollTop > 6);
    }
  }

  (function initGuide() {
    var entry = $("#open-guide");
    if (!entry) return;
    if (guideSeen()) {
      var badge = $("#guide-badge");
      if (badge) badge.classList.add("hidden");
    } else {
      entry.classList.add("is-new");
    }
    entry.addEventListener("click", openGuide);
    var back = $("#guide-back");
    if (back) back.addEventListener("click", closeGuide);
    var start = $("#guide-start");
    if (start) start.addEventListener("click", closeGuide);
  })();

  /* ---------------- 数据备份 ---------------- */

  var BACKUP_FORMAT = "jieshu.backup";
  var BACKUP_VERSION = 1;
  function backupStamp() {
    var d = new Date();
    var p = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes())
    );
  }

  function buildBackup(includeKey) {
    var ai = (db.settings && db.settings.ai) || {};
    var wrapped = {
      provider: ai.provider || "",
      url: ai.url || "",
      model: ai.model || "",
      modelName: ai.modelName || "",
      manualModel: ai.manualModel === true,
      models: ai.models || []
    };
    if (includeKey && ai.key) wrapped.key = ai.key;
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "界书",
      exportedAt: new Date().toISOString(),
      withApiKey: !!(includeKey && ai.key),
      worlds: db.worlds,
      personas: db.personas,
      groups: db.groups,
      settings: { ai: wrapped }
    };
  }

  function exportBackup() {
    var box = $("#backup-with-key");
    var includeKey = box ? box.checked : false;

    closeSheet();
    var payload = buildBackup(includeKey);
    if (!payload.worlds.length && !payload.personas.length) {
      showToast("还没有可以备份的内容");
      return;
    }
    var name = "jieshu-backup-" + backupStamp() + ".json";
    var text = JSON.stringify(payload, null, 2);
    if (window.AndroidBackup && typeof window.AndroidBackup.save === "function") {
      showToast(includeKey && payload.withApiKey ? "正在导出（含 API Key）…" : "正在导出备份…");
      try {
        window.AndroidBackup.save(text, name);
      } catch (err) {
        showToast("导出失败，请重试");
      }
      return;
    }
    try {
      var blob = new Blob([text], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1200);
      showToast("备份文件已生成");
    } catch (err) {
      showToast("导出失败，请重试");
    }
  }

  window.onBackupSaved = function (ok) {
    var label = window.__exportLabel || "备份文件";
    window.__exportLabel = "";
    showToast(ok ? "已保存" + label : "保存已取消");
  };

  function pickBackupFile() {
    if (window.AndroidBackup && typeof window.AndroidBackup.pick === "function") {
      try {
        window.AndroidBackup.pick();
        return;
      } catch (err) {
        /* 落到下面的浏览器方案 */
      }
    }
    var input = $("#backup-file");
    if (!input) return;
    input.value = "";
    input.click();
  }

  window.onBackupPicked = function (text) {
    if (!text || !String(text).trim()) {
      showToast("没有选择备份文件");
      return;
    }
    applyBackupText(String(text));
  };

  /* 备份里带了 Key 时：当前没有 Key 才补上，已有 Key 绝不覆盖。 */
  function adoptBackupAI(data) {
    var incoming = data && data.settings && data.settings.ai;
    if (!incoming || typeof incoming !== "object") return false;
    var ai = db.settings.ai;
    var changed = false;
    var text = function (value) {
      return typeof value === "string" ? value.trim() : "";
    };
    if (!text(ai.url) && text(incoming.url)) {
      ai.url = text(incoming.url);
      changed = true;
    }
    if (!text(ai.model) && text(incoming.model)) {
      ai.model = text(incoming.model);
      ai.modelName = text(incoming.modelName) || ai.modelName;
      ai.manualModel = incoming.manualModel === true;
      changed = true;
    }
    if (!text(ai.provider) && text(incoming.provider)) {
      ai.provider = text(incoming.provider);
      changed = true;
    }
    if (Array.isArray(incoming.models) && incoming.models.length) {
      ai.models = incoming.models.slice();
      changed = true;
    }
    if (!text(ai.key) && text(incoming.key)) {
      ai.key = text(incoming.key);
      changed = true;
    }
    if (changed) {
      ai.provider = detectAIProvider(ai.url, ai.model) || ai.provider;
    }
    return changed;
  }

  function applyBackupText(text) {
    var data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showToast("这个文件不是界书备份");
      return;
    }
    if (
      !data ||
      typeof data !== "object" ||
      (!Array.isArray(data.worlds) && !Array.isArray(data.personas))
    ) {
      showToast("这个文件不是界书备份");
      return;
    }

    var incomingWorlds = Array.isArray(data.worlds) ? data.worlds : [];
    var incomingPersonas = Array.isArray(data.personas) ? data.personas : [];
    var incomingGroups = Array.isArray(data.groups) ? data.groups : [];
    var worldIds = {};
    var personaIds = {};
    var groupIds = {};
    db.worlds.forEach(function (world) {
      worldIds[world.id] = true;
    });
    db.personas.forEach(function (persona) {
      personaIds[persona.id] = true;
    });
    db.groups.forEach(function (group) {
      groupIds[group.id] = true;
    });

    var addedWorlds = 0;
    var addedPersonas = 0;
    var addedGroups = 0;

    incomingGroups.forEach(function (group) {
      if (!group || typeof group !== "object") return;
      var id = typeof group.id === "string" && group.id ? group.id : uid("g");
      if (groupIds[id]) return;
      groupIds[id] = true;
      db.groups.push({
        id: id,
        name: typeof group.name === "string" && group.name ? group.name : "未命名组",
        collapsed: group.collapsed === true,
        createdAt: Number(group.createdAt) || Date.now()
      });
      addedGroups += 1;
    });

    incomingPersonas.forEach(function (persona) {
      if (!persona || typeof persona !== "object") return;
      var id = typeof persona.id === "string" && persona.id ? persona.id : uid("p");
      if (personaIds[id]) return;
      personaIds[id] = true;
      var copy = JSON.parse(JSON.stringify(persona));
      copy.id = id;
      if (!copy.name) copy.name = "未命名角色";
      copy.createdAt = Number(copy.createdAt) || Date.now();
      db.personas.push(copy);
      addedPersonas += 1;
    });

    incomingWorlds.forEach(function (world) {
      if (!world || typeof world !== "object") return;
      var id = typeof world.id === "string" && world.id ? world.id : uid("w");
      if (worldIds[id]) return;
      worldIds[id] = true;
      var copy = JSON.parse(JSON.stringify(world));
      copy.id = id;
      copy.npcs = Array.isArray(copy.npcs) ? copy.npcs : [];
      copy.rules = Array.isArray(copy.rules) ? copy.rules : [];
      copy.createdAt = Number(copy.createdAt) || Date.now();
      copy.updatedAt = Number(copy.updatedAt) || Date.now();
      db.worlds.push(copy);
      addedWorlds += 1;
    });

    var aiChanged = adoptBackupAI(data);

    if (!addedWorlds && !addedPersonas && !addedGroups) {
      if (aiChanged) {
        persist(true);
        syncSettingsForm();
        showToast("已恢复 AI 配置");
      } else {
        showToast("备份里的内容都已经在应用里了");
      }
      return;
    }

    persist(true);
    renderWorlds();
    if (aiChanged) syncSettingsForm();
    var summary = "已导入 " + addedWorlds + " 个世界观";
    if (addedPersonas) summary += "、" + addedPersonas + " 个人设";
    if (addedGroups) summary += "、" + addedGroups + " 个分组";
    if (aiChanged) summary += "，并恢复 AI 配置";
    showToast(summary);
  }

  function openBackupSheet() {
    var root = $("#sheet-root");
    if (!root) return;
    var includeKey = false; /* 每次打开都默认不带，避免误发带 Key 的文件 */
    var chevron =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet backup-sheet" role="dialog" aria-modal="true" aria-label="数据备份">' +
      '<div class="sheet-grab"></div>' +
      '<span class="eyebrow">BACKUP &amp; RESTORE</span>' +
      "<h3>数据备份</h3>" +
      '<p class="sheet-desc">把世界观和人设保存成一个文件；换手机或重装后，用同一个文件恢复。</p>' +
      '<div class="backup-options">' +
      '<button class="backup-option" type="button" data-backup-action="save">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8.4 10.4 12 14l3.6-3.6"/><path d="M5 17.5h14"/></svg></span>' +
      '<span class="bo-main"><strong>保存到文件</strong><span>导出全部世界观、人设与分组</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-backup-action="load">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14V4"/><path d="M8.4 7.6 12 4l3.6 3.6"/><path d="M5 18.5h14"/></svg></span>' +
      '<span class="bo-main"><strong>从文件导入</strong><span>选择以前保存的备份，合并到当前数据</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-backup-action="personas">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.6" cy="8.2" r="3.1"/><path d="M4 19.1c.6-3 2.9-4.9 5.6-4.9s5 1.9 5.6 4.9"/><path d="M17.6 8.4v6.8M15 12.6l2.6 2.6 2.6-2.6"/></svg></span>' +
      '<span class="bo-main"><strong>只保存人设</strong><span>Word 或 JSON，只导出人设库</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-backup-action="worlds">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.4 2.4 3.6 5.2 3.6 8.4s-1.2 6-3.6 8.4c-2.4-2.4-3.6-5.2-3.6-8.4S9.6 6 12 3.6z"/></svg></span>' +
      '<span class="bo-main"><strong>只保存世界观</strong><span>Word 或 JSON，只导出世界观</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-backup-action="chats">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 5.6h14.8v9.6h-8L7.2 18.8v-3.6H4.6z"/><path d="M8.6 9.2h6.8M8.6 11.9h4.4"/></svg></span>' +
      '<span class="bo-main"><strong>只保存对话</strong><span>Word 或 JSON，只导出所有对话</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      "</div>" +
      '<label class="backup-switch" for="backup-with-key">' +
      '<span class="bs-head"><strong>备份里带上 API Key</strong>' +
      '<input type="checkbox" id="backup-with-key" class="bs-input"' +
      (includeKey ? " checked" : "") +
      ">" +
      '<span class="bs-track" aria-hidden="true"><span class="bs-thumb"></span></span></span>' +
      '<span class="bs-hint">默认不带。只在自己的设备之间迁移时再打开；把文件发给别人会泄露 Key。</span>' +
      "</label>" +
      '<p class="backup-tip">导入只会新增内容，不会覆盖或删除现在的世界观与人设。</p>' +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
      "</div></div>";

    requestAnimationFrame(function () {
      root.classList.add("open");
    });

    $$("[data-close-sheet]", root).forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });

    var saveBtn = $('[data-backup-action="save"]', root);
    if (saveBtn) saveBtn.addEventListener("click", exportBackup);
    var loadBtn = $('[data-backup-action="load"]', root);
    if (loadBtn) {
      loadBtn.addEventListener("click", function () {
        closeSheet();
        setTimeout(pickBackupFile, 200);
      });
    }
    var personaBtn = $('[data-backup-action="personas"]', root);
    if (personaBtn) {
      personaBtn.addEventListener("click", function () {
        closeSheet();
        setTimeout(openPersonaExportSheet, 240);
      });
    }
    var worldsBtn = $('[data-backup-action="worlds"]', root);
    if (worldsBtn) {
      worldsBtn.addEventListener("click", function () {
        closeSheet();
        setTimeout(function () {
          if (window.jieshuOpenWorldsExport) window.jieshuOpenWorldsExport();
        }, 240);
      });
    }
    var chatsBtn = $('[data-backup-action="chats"]', root);
    if (chatsBtn) {
      chatsBtn.addEventListener("click", function () {
        closeSheet();
        setTimeout(function () {
          if (window.jieshuOpenChatsExport) window.jieshuOpenChatsExport();
        }, 240);
      });
    }

  }

  (function initBackup() {
    var entry = $("#open-backup");
    if (entry) entry.addEventListener("click", openBackupSheet);
    var input = $("#backup-file");
    if (input) {
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          window.onBackupPicked(String(reader.result || ""));
        };
        reader.onerror = function () {
          showToast("读取文件失败");
        };
        reader.readAsText(file, "utf-8");
      });
    }
  })();

  /* ---------------- 单个世界观导出（DOCX / JSON） ---------------- */

  var DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  function xmlEscape(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function docxRun(text, opts) {
    opts = opts || {};
    var size = opts.size || 22;
    var rpr =
      '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="\u5b8b\u4f53"/>' +
      (opts.bold ? "<w:b/><w:bCs/>" : "") +
      (opts.color ? '<w:color w:val="' + opts.color + '"/>' : "") +
      '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr>';
    return (
      "<w:r>" +
      rpr +
      '<w:t xml:space="preserve">' +
      xmlEscape(text) +
      "</w:t></w:r>"
    );
  }

  function docxPara(text, opts) {
    opts = opts || {};
    var after = opts.after == null ? 120 : opts.after;
    var before = opts.before || 0;
    var ppr =
      "<w:pPr>" +
      '<w:spacing w:before="' +
      before +
      '" w:after="' +
      after +
      '" w:line="300" w:lineRule="auto"/>' +
      (opts.align ? '<w:jc w:val="' + opts.align + '"/>' : "") +
      "</w:pPr>";
    return "<w:p>" + ppr + (text ? docxRun(text, opts) : "") + "</w:p>";
  }

  function docxHeading(text) {
    return docxPara(text, { bold: true, size: 26, before: 240, after: 90 });
  }

  function docxBody(text) {
    return docxPara(text, { size: 22, after: 110 });
  }

  function docxNote(text) {
    return docxPara(text, { size: 20, color: "6B6557", after: 110 });
  }

  function docxTitle(text) {
    return docxPara(text, { bold: true, size: 40, after: 50 });
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function worldDocStamp() {
    var d = new Date();
    return (
      d.getFullYear() +
      "\u5e74" +
      pad2(d.getMonth() + 1) +
      "\u6708" +
      pad2(d.getDate()) +
      "\u65e5 " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  }

  function worldParagraphs(world) {
    var out = [];
    var name = String(world.name || "").trim() || "\u672a\u547d\u540d\u4e16\u754c";
    out.push(docxTitle(name));
    out.push(
      docxNote("\u754c\u4e66 \xb7 \u4e16\u754c\u89c2\u8bbe\u5b9a \xb7 " + worldDocStamp() + " \u5bfc\u51fa")
    );
    out.push(
      docxNote(
        "\u4e0b\u9762\u662f\u8fd9\u4e2a\u4e16\u754c\u7684\u5168\u90e8\u8bbe\u5b9a\u3002\u628a\u8fd9\u4efd\u6587\u6863\u6574\u6bb5\u53d1\u7ed9 AI\uff0c\u5c31\u53ef\u4ee5\u76f4\u63a5\u5728\u8fd9\u4e2a\u4e16\u754c\u91cc\u5f00\u59cb\u5f00\u73a9\u3002"
      )
    );

    out.push(docxHeading("\u4e00\u3001\u4e16\u754c\u540d\u79f0"));
    out.push(docxBody(name));

    out.push(docxHeading("\u4e8c\u3001\u4e00\u53e5\u8bdd\u6982\u8ff0"));
    out.push(
      docxBody(
        String(world.description || "").trim() ||
          "\uff08\u5c1a\u672a\u586b\u5199\uff09"
      )
    );

    out.push(docxHeading("\u4e09\u3001\u5730\u533a"));
    out.push(docxBody(String(world.region || "").trim() || "\uff08\u5c1a\u672a\u586b\u5199\uff09"));

    out.push(docxHeading("\u56db\u3001\u8d27\u5e01\u4e0e\u4ea4\u6362"));
    out.push(
      docxBody(String(world.currency || "").trim() || "\uff08\u5c1a\u672a\u586b\u5199\uff09")
    );

    var npcs = Array.isArray(world.npcs) ? world.npcs : [];
    if (npcs.length) {
      out.push(docxHeading("\u4e94\u3001\u4e3b\u8981\u4eba\u7269"));
      npcs.forEach(function (npc, index) {
        var meta = [];
        var ageText = String(npc.age || "").trim();
        if (ageText) meta.push(/^\d+(\.\d+)?$/.test(ageText) ? ageText + " \u5c81" : ageText);
        if (String(npc.gender || "").trim()) meta.push(String(npc.gender).trim());
        var head =
          index + 1 + "\u3001" + (String(npc.name || "").trim() || "\u672a\u547d\u540d\u89d2\u8272");
        if (meta.length) head += "\uff08" + meta.join(" \xb7 ") + "\uff09";
        out.push(docxPara(head, { bold: true, size: 23, before: 120, after: 60 }));
        out.push(docxBody(String(npc.persona || "").trim() || "\uff08\u4eba\u7269\u8bbe\u5b9a\u5c1a\u672a\u586b\u5199\uff09"));
      });
    }

    var rules = Array.isArray(world.rules) ? world.rules : [];
    if (rules.length) {
      out.push(docxHeading("\u516d\u3001\u4e16\u754c\u89c4\u5219"));
      rules.forEach(function (rule, index) {
        var title = String(rule.title || "").trim();
        out.push(
          docxPara(index + 1 + "\u3001" + (title || "\u672a\u547d\u540d\u89c4\u5219"), {
            bold: true,
            size: 23,
            before: 120,
            after: 60
          })
        );
        out.push(docxBody(String(rule.content || "").trim() || "\uff08\u89c4\u5219\u5185\u5bb9\u5c1a\u672a\u586b\u5199\uff09"));
      });
    }

    out.push(docxHeading("\u4e03\u3001\u600e\u4e48\u7528\u8fd9\u4efd\u8bbe\u5b9a"));
    out.push(
      docxBody(
        "\u8bf7\u4ee5\u4ee5\u4e0a\u6587\u5b57\u8bbe\u5b9a\u4e3a\u51c6\uff0c\u548c\u6211\u4e00\u8d77\u5728\u8fd9\u4e2a\u4e16\u754c\u91cc\u8fdb\u884c\u89d2\u8272\u626e\u6f14\u3002\u4f60\u8d1f\u8d23\u626e\u6f14\u4e16\u754c\u3001\u73af\u5883\u4e0e\u6240\u6709\u89d2\u8272\uff0c\u6211\u53ea\u626e\u6f14\u6211\u81ea\u5df1\uff1b\u4e0d\u8981\u66ff\u6211\u884c\u52a8\u6216\u8bf4\u8bdd\u3002\u5982\u679c\u9047\u5230\u8bbe\u5b9a\u91cc\u6ca1\u5199\u5230\u7684\u7ec6\u8282\uff0c\u4f60\u53ef\u4ee5\u5408\u7406\u8865\u5145\uff0c\u4f46\u4e0d\u8981\u6539\u53d8\u5df2\u7ecf\u5199\u597d\u7684\u89c4\u5219\u4e0e\u4eba\u7269\u5173\u7cfb\u3002"
      )
    );
    out.push(docxNote("\u2014\u2014 \u5b8c \u2014\u2014"));
    return out;
  }

  function docxDocumentXml(paragraphs) {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" +
      paragraphs.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>"
    );
  }

  var DOCX_CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  var DOCX_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  var CRC_TABLE = null;

  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  /* 只用 store（不压缩）写 zip，Word / WPS 都能直接打开 */
  function zipStore(entries) {
    var encoder = new TextEncoder();
    var locals = [];
    var centrals = [];
    var offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = encoder.encode(entry.name);
      var data = entry.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    });

    var centralSize = centrals.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var total = offset + centralSize + end.length;
    var out = new Uint8Array(total);
    var pos = 0;
    locals.concat(centrals, [end]).forEach(function (part) {
      out.set(part, pos);
      pos += part.length;
    });
    return out;
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000;
    var binary = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }
    return btoa(binary);
  }

  function buildWorldDocx(world) {
    var encoder = new TextEncoder();
    var entries = [
      { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
      { name: "_rels/.rels", data: encoder.encode(DOCX_RELS) },
      {
        name: "word/document.xml",
        data: encoder.encode(docxDocumentXml(worldParagraphs(world)))
      }
    ];
    return zipStore(entries);
  }

  function safeFileName(name) {
    var clean = String(name || "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 24);
    return clean || "\u4e16\u754c";
  }

  function worldExportName(world, ext) {
    return (
      "\u754c\u4e66-" +
      safeFileName(world.name) +
      "-" +
      backupStamp() +
      "." +
      ext
    );
  }

  function buildWorldJson(world) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "\u754c\u4e66",
      scope: "world",
      exportedAt: new Date().toISOString(),
      withApiKey: false,
      worlds: [JSON.parse(JSON.stringify(world))],
      personas: [],
      groups: []
    };
  }

  function saveBlobFallback(bytes, mime, fileName) {
    try {
      var blob = new Blob([bytes], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
      showToast("\u5df2\u751f\u6210\u6587\u4ef6");
    } catch (err) {
      showToast("\u5bfc\u51fa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5");
    }
  }

  function exportWorldDocx(world) {
    var bytes;
    try {
      bytes = buildWorldDocx(world);
    } catch (err) {
      showToast("\u751f\u6210\u6587\u6863\u5931\u8d25");
      return;
    }
    var fileName = worldExportName(world, "docx");
    var bridge = window.AndroidBackup;
    if (bridge && typeof bridge.saveBase64 === "function") {
      window.__exportLabel = " Word 文档";
      try {
        bridge.saveBase64(bytesToBase64(bytes), fileName, DOCX_MIME);
        return;
      } catch (err) {
        window.__exportLabel = "";
      }
    }
    saveBlobFallback(bytes, DOCX_MIME, fileName);
  }

  function exportWorldJson(world) {
    var payload = buildWorldJson(world);
    var text = JSON.stringify(payload, null, 2);
    var fileName = worldExportName(world, "json");
    var bridge = window.AndroidBackup;
    if (bridge && typeof bridge.save === "function") {
      window.__exportLabel = " JSON 文件";
      try {
        bridge.save(text, fileName);
        return;
      } catch (err) {
        window.__exportLabel = "";
      }
    }
    saveBlobFallback(new TextEncoder().encode(text), "application/json", fileName);
  }

  function openWorldExportSheet() {
    var world = currentWorld();
    var root = $("#sheet-root");
    if (!world || !root) {
      showToast("\u5148\u6253\u5f00\u4e00\u4e2a\u4e16\u754c");
      return;
    }
    var worldName = String(world.name || "").trim() || "\u8fd9\u4e2a\u4e16\u754c";
    var chevron =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="\u5bfc\u51fa\u4e16\u754c\u89c2">' +
      '<div class="sheet-grab"></div>' +
      '<span class="eyebrow">EXPORT ONE WORLD</span>' +
      "<h3>\u5bfc\u51fa\u8fd9\u4e2a\u4e16\u754c</h3>" +
      '<p class="sheet-desc">\u53ea\u5bfc\u51fa\u300c' +
      xmlEscape(worldName) +
      "\u300d\u8fd9\u4e00\u4e2a\u4e16\u754c\uff08\u542b\u5b83\u7684\u4eba\u7269\u4e0e\u89c4\u5219\uff09\uff0c\u5176\u4ed6\u4e16\u754c\u4e0d\u53d7\u5f71\u54cd\u3002</p>" +
      '<div class="backup-options">' +
      '<button class="backup-option" type="button" data-world-export="docx">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13 3.5V8h4.5"/><path d="M9.2 12.4h5.6M9.2 15.4h5.6M9.2 18h3.4"/></svg></span>' +
      '<span class="bo-main"><strong>Word \u6587\u6863\uff08.docx\uff09</strong><span>\u7eaf\u6587\u5b57\u8bbe\u5b9a\uff0c\u53d1\u7ed9 AI \u5c31\u80fd\u76f4\u63a5\u5f00\u73a9</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-world-export="json">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5H7.8a2 2 0 0 0-2 2v3.2c0 1-.7 1.8-1.6 1.8.9 0 1.6.8 1.6 1.8v3.2a2 2 0 0 0 2 2h1.7"/><path d="M14.5 4.5h1.7a2 2 0 0 1 2 2v3.2c0 1 .7 1.8 1.6 1.8-.9 0-1.6.8-1.6 1.8v3.2a2 2 0 0 1-2 2h-1.7"/></svg></span>' +
      '<span class="bo-main"><strong>JSON \u6587\u4ef6\uff08.json\uff09</strong><span>\u5b8c\u6574\u7ed3\u6784\u5316\u6570\u636e\uff0c\u53ef\u518d\u5bfc\u5165\u56de\u754c\u4e66</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      "</div>" +
      '<p class="backup-tip">\u5bfc\u5165\u8fd9\u4e2a JSON\uff1a\u9876\u680f\u300c\u6570\u636e\u5907\u4efd \u2192 \u4ece\u6587\u4ef6\u5bfc\u5165\u300d\uff0c\u7cfb\u7edf\u4f1a\u628a\u5b83\u5f53\u4f5c\u4e00\u4efd\u53ea\u542b\u8be5\u4e16\u754c\u7684\u5907\u4efd\u3002</p>' +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" type="button" data-close-sheet>\u53d6\u6d88</button>' +
      "</div></div>";

    requestAnimationFrame(function () {
      root.classList.add("open");
    });

    $$("[data-close-sheet]", root).forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });

    $$("[data-world-export]", root).forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.dataset.worldExport;
        var target = currentWorld();
        closeSheet();
        if (!target) return;
        setTimeout(function () {
          if (kind === "docx") exportWorldDocx(target);
          else exportWorldJson(target);
        }, 220);
      });
    });
  }

  (function initWorldExport() {
    var button = $("#export-world");
    if (button) button.addEventListener("click", openWorldExportSheet);
  })();

  /* ---------------- 世界观列表 ---------------- */

  function worldCardHTML(world, index) {
    var name = displayWorldName(world);
    var desc = world.description && world.description.trim();
    var selected = selectedWorldIds.has(world.id);
    var meta =
      "<span>" +
      world.npcs.length +
      " 位 NPC</span>" +
      '<span class="dot"></span>' +
      "<span>" +
      world.rules.length +
      " 条规则</span>";
    if (world.fusedFrom && world.fusedFrom.length) {
      meta += '<span class="dot"></span><span class="fusion-mark">AI 融合</span>';
    }
    var tags = "";
    if (
      (world.region && world.region.trim()) ||
      (world.currency && world.currency.trim())
    ) {
      tags =
        '<span class="world-tags">' +
        (world.region && world.region.trim()
          ? '<span>地区 · ' + esc(world.region.trim()) + "</span>"
          : "") +
        (world.currency && world.currency.trim()
          ? '<span>货币 · ' + esc(world.currency.trim()) + "</span>"
          : "") +
        "</span>";
    }
    return (
      '<button class="world-card ' +
      toneFor(world.id) +
      (selectionMode ? " selectable" : "") +
      (selected ? " selected" : "") +
      '" type="button" data-world-id="' +
      esc(world.id) +
      '" style="animation-delay:' +
      Math.min(index * 35, 210) +
      'ms" aria-label="打开世界观 ' +
      esc(name) +
      '"' +
      (selectionMode ? ' aria-pressed="' + (selected ? "true" : "false") + '"' : "") +
      ">" +
      '<span class="selection-mark" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4L19 6.5"/></svg>' +
      "</span>" +
      '<span class="world-glyph" aria-hidden="true">' +
      esc(firstChar(name, "界")) +
      "</span>" +
      '<span class="world-body">' +
      '<span class="world-name">' +
      esc(name) +
      "</span>" +
      '<span class="world-desc">' +
      esc(desc || "尚未写下世界概述") +
      "</span>" +
      tags +
      '<span class="world-meta">' +
      meta +
      "</span>" +
      "</span>" +
      '<span class="world-arrow" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5l7 7-7 7"/></svg>' +
      "</span>" +
      "</button>"
    );
  }

  function groupBlockHTML(group, worlds, startIndex) {
    var cards = worlds
      .map(function (world, index) {
        return worldCardHTML(world, startIndex + index);
      })
      .join("");
    var collapsed = group.collapsed === true;
    return (
      '<div class="group-block' +
      (collapsed ? " collapsed" : "") +
      '" data-group-id="' +
      esc(group.id) +
      '">' +
      '<div class="group-head">' +
      '<button class="group-toggle" type="button" data-action="toggle-group" data-group-id="' +
      esc(group.id) +
      '" aria-expanded="' +
      (collapsed ? "false" : "true") +
      '" aria-label="' +
      (collapsed ? "展开" : "收起") +
      "组 " +
      esc(group.name || "未命名组") +
      '">' +
      '<span class="group-chevron" aria-hidden="true"></span>' +
      '<span class="group-head-copy">' +
      '<span class="eyebrow">GROUP</span>' +
      '<span class="group-name">' +
      esc(group.name || "未命名组") +
      "</span>" +
      '<span class="group-count">' +
      worlds.length +
      " 个世界</span>" +
      "</span>" +
      "</button>" +
      '<button class="group-rename" type="button" data-action="rename-group" data-group-id="' +
      esc(group.id) +
      '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/></svg>' +
      "改名</button>" +
      "</div>" +
      (collapsed ? "" : '<div class="group-worlds">' + cards + "</div>") +
      "</div>"
    );
  }

  function emptyWorldsHTML() {
    return (
      '<div class="empty-worlds">' +
      '  <div class="empty-art" aria-hidden="true">' +
      '    <span class="ring a"></span><span class="ring b"></span>' +
      '    <span class="spark">✦</span>' +
      '    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">' +
      '      <path d="M11 12.5c4.6-1.4 8.9-.9 13 1.8 4.1-2.7 8.4-3.2 13-1.8v23c-4.6-1.3-8.9-.8-13 1.9-4.1-2.7-8.4-3.2-13-1.9v-23Z"/>' +
      '      <path d="M24 14.3v23"/>' +
      '      <path d="M16 19.5c2.1-.2 4 .1 5.6 1M16 24c2.1-.2 4 .1 5.6 1M31.8 19.4c-1.7-.1-3.4.2-5 1M31.8 23.9c-1.7-.1-3.4.2-5 1"/>' +
      '    </svg>' +
      '  </div>' +
      '  <h4>还没有世界观</h4>' +
      "  <p>点击右上角的 + ，<br>为你的第一个世界命名。</p>" +
      '  <button id="empty-create" class="btn ghost" type="button">创建第一个世界</button>' +
      "</div>"
    );
  }

  function updateSelectionUI() {
    var view = $("#view-worlds");
    var banner = $("#selection-banner");
    var bar = $("#selection-bar");
    var hint = $("#multi-hint");
    if (view) view.classList.toggle("selection-mode", selectionMode);
    if (banner) banner.classList.toggle("hidden", !selectionMode);
    if (bar) {
      bar.classList.toggle("visible", selectionMode);
      bar.setAttribute("aria-hidden", selectionMode ? "false" : "true");
    }
    if (hint) {
      hint.classList.toggle(
        "hidden",
        selectionMode || readyWorldCount() < 2
      );
    }
    var countEl = $("#selected-count");
    if (countEl) countEl.textContent = String(selectedWorldIds.size);
    var fuse = $("#selection-fuse");
    if (fuse) fuse.classList.toggle("disabled", selectedWorldIds.size < 2);
    var note = $("#selection-note");
    if (note) {
      note.textContent =
        selectedWorldIds.size < 2
          ? "至少选择两个世界才能融合"
          : "融合会生成一个新的世界，原世界不会删除";
    }
    var tabbar = $("#tabbar");
    if (tabbar) {
      var activeScreen = $(".screen.active");
      var activeName = activeScreen
        ? activeScreen.id.replace("view-", "")
        : "";
      if (selectionMode && activeName === "worlds") {
        tabbar.classList.add("hidden");
      } else if (activeName === "worlds" || activeName === "personas") {
        tabbar.classList.remove("hidden");
      }
    }
  }

  function renderWorlds() {
    var list = $("#world-list");
    var count = $("#world-count");
    if (!list || !count) return;

    count.textContent = String(db.worlds.length);
    var worlds = db.worlds.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    if (!worlds.length) {
      selectionMode = false;
      selectedWorldIds.clear();
      list.innerHTML = emptyWorldsHTML();
      updateSelectionUI();
      return;
    }

    var html = "";
    var cardIndex = 0;
    var groups = db.groups.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    var renderedGroups = 0;

    groups.forEach(function (group) {
      var groupWorlds = worlds.filter(function (world) {
        return world.groupId === group.id;
      });
      if (!groupWorlds.length) return;
      html += groupBlockHTML(group, groupWorlds, cardIndex);
      cardIndex += groupWorlds.length;
      renderedGroups += 1;
    });

    var ungrouped = worlds.filter(function (world) {
      return !world.groupId || !findGroup(world.groupId);
    });
    if (ungrouped.length) {
      if (renderedGroups) {
        html += '<div class="ungrouped-label">未分组</div>';
      }
      html +=
        '<div class="group-block ungrouped-block">' +
        '<div class="group-worlds">' +
        ungrouped
          .map(function (world, index) {
            return worldCardHTML(world, cardIndex + index);
          })
          .join("") +
        "</div></div>";
    }

    list.innerHTML = html;
    updateSelectionUI();
  }

  function enterSelection(worldId) {
    var world = findWorld(worldId);
    if (!world) return;
    if (!worldIsReady(world)) {
      showToast("先完善这个世界，再长按进入多选");
      return;
    }
    if (readyWorldCount() < 2) {
      showToast("再完善一个世界观，即可长按多选");
      return;
    }
    selectionMode = true;
    selectedWorldIds.clear();
    selectedWorldIds.add(worldId);
    suppressClickUntil = Date.now() + 700;
    suppressClickWorldId = worldId;
    renderWorlds();
    if (navigator.vibrate) {
      try {
        navigator.vibrate(12);
      } catch (err) {
        /* 某些设备不支持震动 */
      }
    }
  }

  function toggleSelection(worldId) {
    if (selectedWorldIds.has(worldId)) {
      selectedWorldIds.delete(worldId);
    } else {
      selectedWorldIds.add(worldId);
    }
    renderWorlds();
  }

  function exitSelection() {
    selectionMode = false;
    selectedWorldIds.clear();
    suppressClickUntil = 0;
    suppressClickWorldId = null;
    renderWorlds();
  }

  function addWorld() {
    var world = {
      id: uid("w"),
      name: "",
      description: "",
      region: "",
      currency: "",
      groupId: null,
      sourcePrompt: "",
      fusedFrom: [],
      npcs: [],
      rules: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (selectionMode) exitSelection();
    db.worlds.push(world);
    persist(true);
    renderWorlds();
    openEditor(world.id, true);
  }

  function openEditor(worldId, focusName) {
    var world = findWorld(worldId);
    if (!world) return;
    if (selectionMode) exitSelection();

    currentWorldId = worldId;
    openNpcIds.clear();
    showScreen("editor");
    setTabUI("worlds");

    $("#world-name").value = world.name || "";
    $("#world-desc").value = world.description || "";
    $("#world-region").value = world.region || "";
    $("#world-currency").value = world.currency || "";
    renderNpcList();
    renderRules();
    updateEditorCounts();
    updateAIReadyBadge();
    autoGrow($("#world-desc"));
    setSaveState("saved");
    $("#editor-scroll").scrollTop = 0;

    if (focusName) {
      setTimeout(function () {
        var input = $("#world-name");
        if (!input) return;
        input.focus();
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch (err) {
          /* 某些输入法不支持 setSelectionRange，忽略 */
        }
      }, 180);
    }
  }

  function closeEditor() {
    var world = currentWorld();
    if (world) {
      world.name = world.name.trim() || "未命名世界";
      world.description = world.description.trim();
      world.region = world.region.trim();
      world.currency = world.currency.trim();
      touch(world);
      persist(true);
    }
    currentWorldId = null;
    openNpcIds.clear();
    selectionMode = false;
    selectedWorldIds.clear();
    setTabUI("worlds");
    renderWorlds();
    showScreen("worlds");
    var view = $("#view-worlds");
    if (view) view.scrollTop = 0;
  }

  function updateAIReadyBadge() {
    var ready = isAIConfigured();
    var label = ready ? "已配置" : "未配置";
    ["#ai-ready-badge", "#persona-ai-badge"].forEach(function (selector) {
      var badge = $(selector);
      if (!badge) return;
      badge.classList.toggle("ready", ready);
      badge.textContent = label;
    });
  }

  /* ---------------- NPC ---------------- */

  function npcHTML(npc, isOpen) {
    var name = displayNpcName(npc);
    return (
      '<article class="npc-card' +
      (isOpen ? " open" : "") +
      '" data-npc-id="' +
      esc(npc.id) +
      '">' +
      '<button class="npc-head" type="button" data-action="toggle-npc" aria-expanded="' +
      (isOpen ? "true" : "false") +
      '" aria-label="展开编辑 ' +
      esc(name) +
      '">' +
      '<span class="npc-avatar" data-role="npc-avatar" aria-hidden="true">' +
      esc(firstChar(name, "?")) +
      "</span>" +
      '<span class="npc-main">' +
      '<span class="npc-name" data-role="npc-name">' +
      esc(name) +
      "</span>" +
      '<span class="npc-sub" data-role="npc-sub">' +
      esc(npcMeta(npc)) +
      "</span>" +
      "</span>" +
      '<span class="chevron-box" aria-hidden="true"><span class="npc-chevron"></span></span>' +
      "</button>" +
      '<div class="npc-panel">' +
      '<div class="field-row">' +
      '<label class="field"><span>NPC 名字</span>' +
      '<input class="text-input" data-field="name" type="text" maxlength="20" placeholder="角色名" autocomplete="off" value="' +
      esc(npc.name) +
      '"></label>' +
      '<label class="field"><span>年龄</span>' +
      '<input class="text-input" data-field="age" type="text" inputmode="text" maxlength="12" placeholder="如 24" autocomplete="off" value="' +
      esc(npc.age) +
      '"></label>' +
      "</div>" +
      '<div class="field"><span class="field-label-text">性别</span>' +
      '<div class="segmented" role="group" aria-label="性别">' +
      GENDERS.map(function (gender) {
        return (
          '<button class="seg' +
          (npc.gender === gender ? " active" : "") +
          '" type="button" data-action="gender" data-gender="' +
          gender +
          '">' +
          gender +
          "</button>"
        );
      }).join("") +
      "</div></div>" +
      '<label class="field"><span>人物设定</span>' +
      '<textarea class="text-area" data-field="persona" maxlength="6000" placeholder="出身、性格、欲望、秘密、说话方式……">' +
      esc(npc.persona) +
      "</textarea></label>" +
      '<div class="npc-actions">' +
      '<button class="text-danger" type="button" data-action="delete-npc">删除 NPC</button>' +
      '<span class="auto-hint">修改自动保存</span>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function renderNpcList() {
    var world = currentWorld();
    var list = $("#npc-list");
    if (!world || !list) return;

    if (!world.npcs.length) {
      list.innerHTML =
        '<div class="npc-empty"><strong>还没有主要 NPC</strong>' +
        "先为世界添上第一位居民，<br>或等之后从人设库中挑选。</div>";
      return;
    }

    list.innerHTML = world.npcs
      .map(function (npc) {
        return npcHTML(npc, openNpcIds.has(npc.id));
      })
      .join("");

    $$(".npc-card.open .text-area", list).forEach(autoGrow);
  }

  function updateNpcHeader(card, npc) {
    if (!card || !npc) return;
    var name = displayNpcName(npc);
    var nameEl = $('[data-role="npc-name"]', card);
    var subEl = $('[data-role="npc-sub"]', card);
    var avatarEl = $('[data-role="npc-avatar"]', card);
    if (nameEl) nameEl.textContent = name;
    if (subEl) subEl.textContent = npcMeta(npc);
    if (avatarEl) avatarEl.textContent = firstChar(name, "?");
  }

  function addNpc() {
    var world = currentWorld();
    if (!world) return;
    var npc = {
      id: uid("n"),
      name: "",
      age: "",
      gender: "男",
      persona: ""
    };
    world.npcs.push(npc);
    openNpcIds.add(npc.id);
    touch(world);
    persist(true);
    renderNpcList();
    updateEditorCounts();
    setTimeout(function () {
      var card = $('.npc-card[data-npc-id="' + npc.id + '"]');
      if (!card) return;
      scrollEditorTo(card, true);
      var input = $('[data-field="name"]', card);
      if (input) input.focus();
    }, 120);
  }

  function toggleNpc(card) {
    var id = card.dataset.npcId;
    var isOpen = openNpcIds.has(id);
    var button = $(".npc-head", card);
    if (isOpen) {
      openNpcIds.delete(id);
      card.classList.remove("open");
      if (button) button.setAttribute("aria-expanded", "false");
    } else {
      openNpcIds.add(id);
      card.classList.add("open");
      if (button) button.setAttribute("aria-expanded", "true");
      setTimeout(function () {
        $$(".text-area", card).forEach(autoGrow);
      }, 30);
    }
  }

  function handleNpcInput(target) {
    var card = target.closest(".npc-card");
    if (!card) return;
    var world = currentWorld();
    var npc = findNpc(world, card.dataset.npcId);
    if (!npc) return;
    var field = target.dataset.field;
    if (!field) return;
    npc[field] = target.value;
    touch(world);
    updateNpcHeader(card, npc);
    maybeGrow(target);
    persist(false);
  }

  function selectNpcGender(button) {
    var card = button.closest(".npc-card");
    if (!card) return;
    var world = currentWorld();
    var npc = findNpc(world, card.dataset.npcId);
    if (!npc) return;
    npc.gender = button.dataset.gender;
    $$(".seg", card).forEach(function (seg) {
      seg.classList.toggle("active", seg === button);
    });
    touch(world);
    updateNpcHeader(card, npc);
    persist(false);
  }

  function deleteNpc(card) {
    var world = currentWorld();
    var npc = findNpc(world, card.dataset.npcId);
    if (!npc) return;
    confirmDialog({
      title: "删除这个 NPC？",
      message:
        "「" +
        displayNpcName(npc) +
        "」的名字、年龄、性别与人物设定都会一并删除，无法恢复。",
      confirmText: "删除 NPC"
    }).then(function (confirmed) {
      if (!confirmed) return;
      var liveWorld = currentWorld();
      if (!liveWorld) return;
      liveWorld.npcs = liveWorld.npcs.filter(function (item) {
        return item.id !== npc.id;
      });
      openNpcIds.delete(npc.id);
      touch(liveWorld);
      persist(true);
      renderNpcList();
      updateEditorCounts();
      showToast("NPC 已删除");
    });
  }

  /* ---------------- 基础规则 ---------------- */

  function ruleHTML(rule, index) {
    return (
      '<article class="rule-card" data-rule-id="' +
      esc(rule.id) +
      '">' +
      '<div class="rule-top"><span class="rule-index">' +
      (index + 1 < 10 ? "0" : "") +
      (index + 1) +
      "</span>" +
      '<input class="rule-title" data-rule-field="title" type="text" maxlength="40" placeholder="规则名称，例如：灵力的代价" autocomplete="off" value="' +
      esc(rule.title) +
      '"></div>' +
      '<textarea class="rule-content" data-rule-field="content" maxlength="2000" placeholder="写下这个世界的底层规则…">' +
      esc(rule.content) +
      "</textarea>" +
      '<button class="rule-delete" type="button" data-action="delete-rule" aria-label="删除这条规则">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>" +
      "</article>"
    );
  }

  function renderRules() {
    var world = currentWorld();
    var list = $("#rule-list");
    if (!world || !list) return;

    if (!world.rules.length) {
      list.innerHTML =
        '<div class="rule-empty"><strong>尚未立下规则</strong>' +
        "规则不必解释原因，<br>只需让世界因此可信。</div>";
      return;
    }

    list.innerHTML = world.rules
      .map(function (rule, index) {
        return ruleHTML(rule, index);
      })
      .join("");
    $$(".rule-content", list).forEach(autoGrow);
  }

  function addRule() {
    var world = currentWorld();
    if (!world) return;
    var rule = { id: uid("r"), title: "", content: "" };
    world.rules.push(rule);
    touch(world);
    persist(true);
    renderRules();
    updateEditorCounts();
    setTimeout(function () {
      var card = $('.rule-card[data-rule-id="' + rule.id + '"]');
      if (!card) return;
      scrollEditorTo(card, true);
      var input = $(".rule-title", card);
      if (input) input.focus();
    }, 120);
  }

  function handleRuleInput(target) {
    var card = target.closest(".rule-card");
    if (!card) return;
    var world = currentWorld();
    var rule = findRule(world, card.dataset.ruleId);
    if (!rule) return;
    var field = target.dataset.ruleField;
    if (!field) return;
    rule[field] = target.value;
    touch(world);
    if (field === "content") autoGrow(target);
    persist(false);
  }

  function deleteRule(button) {
    var card = button.closest(".rule-card");
    var world = currentWorld();
    var rule = findRule(world, card.dataset.ruleId);
    if (!rule) return;
    confirmDialog({
      title: "删除这条规则？",
      message: (rule.title ? "「" + rule.title + "」" : "这条规则") + "会从世界中移除。",
      confirmText: "删除规则"
    }).then(function (confirmed) {
      if (!confirmed) return;
      var liveWorld = currentWorld();
      if (!liveWorld) return;
      liveWorld.rules = liveWorld.rules.filter(function (item) {
        return item.id !== rule.id;
      });
      touch(liveWorld);
      persist(true);
      renderRules();
      updateEditorCounts();
      showToast("规则已删除");
    });
  }

  /* ---------------- 计数 ---------------- */

  function updateEditorCounts() {
    var world = currentWorld();
    if (!world) return;
    var npcCount = $("#npc-count");
    var ruleCount = $("#rule-count");
    if (npcCount) npcCount.textContent = String(world.npcs.length);
    if (ruleCount) ruleCount.textContent = String(world.rules.length);
  }

  /* ---------------- 人设库选择 ---------------- */

  function closeSheet() {
    var root = $("#sheet-root");
    if (!root) return;
    root.classList.remove("open");
    setTimeout(function () {
      if (!root.classList.contains("open")) root.innerHTML = "";
    }, 360);
  }

  function openPersonaPicker() {
    var root = $("#sheet-root");
    if (!root) return;

    var content = "";
    if (db.personas.length) {
      content = db.personas
        .map(function (persona) {
          return (
            '<button class="persona-choice" type="button" data-persona-id="' +
            esc(persona.id) +
            '">' +
            '<span class="pc-avatar">' +
            esc(firstChar(persona.name, "?")) +
            "</span>" +
            '<span class="pc-main"><span class="pc-name">' +
            esc(displayNpcName(persona)) +
            "</span>" +
            '<span class="pc-sub">' +
            esc(npcMeta(persona) + " · " + personaTypeLabel(persona.type)) +
            "</span></span>" +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' +
            "</button>"
          );
        })
        .join("");
    } else {
      content =
        '<div class="sheet-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c.7-3.6 3.3-5.8 7-5.8s6.3 2.2 7 5.8"/></svg>' +
        "<strong>人设库还是空的</strong>" +
        "<p>这一栏先为你留白。<br>现在可以直接在这个世界里写下角色。</p>" +
        "</div>";
    }

    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="从人设库挑选">' +
      '<div class="sheet-grab"></div>' +
      "<h3>从人设库挑选</h3>" +
      '<p class="sheet-desc">把人设库中的角色加入当前世界，成为主要 NPC。TA 的外貌、性格与过往会一起带过来。</p>' +
      content +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" type="button" data-close-sheet>稍后再说</button>' +
      (db.personas.length
        ? ""
        : '<button class="btn primary" type="button" data-add-now>直接添加 NPC</button>') +
      "</div></div>";

    requestAnimationFrame(function () {
      root.classList.add("open");
    });

    $$("[data-close-sheet]", root).forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });

    var addNow = $("[data-add-now]", root);
    if (addNow) {
      addNow.addEventListener("click", function () {
        closeSheet();
        setTimeout(addNpc, 260);
      });
    }

    $$("[data-persona-id]", root).forEach(function (button) {
      button.addEventListener("click", function () {
        var personaId = button.dataset.personaId;
        var persona = db.personas.filter(function (item) {
          return item.id === personaId;
        })[0];
        if (!persona) return;
        var world = currentWorld();
        if (!world) return;
        var npc = {
          id: uid("n"),
          name: persona.name,
          age: persona.age,
          gender: persona.gender,
          persona: personaBrief(persona)
        };
        world.npcs.push(npc);
        openNpcIds.add(npc.id);
        touch(world);
        persist(true);
        renderNpcList();
        updateEditorCounts();
        closeSheet();
        showToast("已加入世界观");
      });
    });
  }

  /* ---------------- 人设库 ---------------- */

  var PERSONA_TYPE_LABEL = { user: "用户人设", npc: "NPC 人设" };

  var PERSONA_FIELDS = {
    name: "#pe-name",
    height: "#pe-height",
    weight: "#pe-weight",
    age: "#pe-age",
    appearance: "#pe-appearance",
    personality: "#pe-personality",
    figure: "#pe-figure",
    inner: "#pe-inner",
    history: "#pe-history"
  };

  var personaDraft = null;
  var personaIsNew = false;

  function personaById(id) {
    for (var i = 0; i < db.personas.length; i++) {
      if (db.personas[i].id === id) return db.personas[i];
    }
    return null;
  }

  function personaTypeLabel(type) {
    return PERSONA_TYPE_LABEL[type] || PERSONA_TYPE_LABEL.user;
  }

  function withUnit(value, unit) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return "";
    return /^[0-9]+(\.[0-9]+)?$/.test(text) ? text + " " + unit : text;
  }

  function personaMeasure(persona) {
    var parts = [];
    if (persona.gender) parts.push(persona.gender);
    var height = withUnit(persona.height, "cm");
    if (height) parts.push(height);
    var weight = withUnit(persona.weight, "kg");
    if (weight) parts.push(weight);
    var age = String(persona.age == null ? "" : persona.age).trim();
    if (age) parts.push(/^[0-9]+$/.test(age) ? age + " 岁" : age);
    return parts.join(" · ");
  }

  function personaSnippet(persona) {
    var picks = [
      ["personality", "性格"],
      ["appearance", "外貌"],
      ["inner", "内心"]
    ];
    for (var i = 0; i < picks.length; i++) {
      var text = String(persona[picks[i][0]] || "").trim();
      if (text) return picks[i][1] + "：" + text;
    }
    var legacy = String(persona.persona || "").trim();
    if (legacy) return legacy;
    return "「TA 的样子，还等着你写下来。」";
  }

  function personaBrief(persona) {
    var lines = [];
    var measure = personaMeasure(persona);
    function add(label, value) {
      var text = String(value == null ? "" : value).trim();
      if (text) lines.push(label + "：" + text);
    }
    if (measure) lines.push("（" + measure + "）");
    var abilities = personaAbilities(persona);
    if (abilities.length) lines.push("能力：" + abilities.join("、"));
    add("外貌", persona.appearance);
    add("性格", persona.personality);
    add("身材", persona.figure);
    add("内心", persona.inner);
    add("过往", persona.history);
    if (lines.length <= 1) {
      var legacy = String(persona.persona || "").trim();
      if (legacy) return legacy;
    }
    return lines.join("\n");
  }

  function personaGroupHtml(title, note, items) {
    var cards = "";
    if (!items.length) {
      cards =
        '<p class="persona-group-empty">还没有 ' +
        esc(title) +
        "。点右上角的 ＋ 建一份。</p>";
    } else {
      cards = items
        .map(function (persona) {
          return (
            '<button class="persona-card" type="button" data-persona-id="' +
            esc(persona.id) +
            '">' +
            '<span class="pa-avatar">' +
            esc(firstChar(displayNpcName(persona), "?")) +
            "</span>" +
            '<span class="pa-main">' +
            '<span class="pa-row"><span class="pa-name">' +
            esc(displayNpcName(persona)) +
            "</span></span>" +
            '<span class="pa-meta">' +
            esc(personaMeasure(persona) || "资料待补充") +
            "</span>" +
            '<span class="pa-snippet">' +
            esc(personaSnippet(persona)) +
            "</span>" +
            "</span>" +
            '<span class="pa-chev"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span>' +
            "</button>"
          );
        })
        .join("");
    }
    return (
      '<section class="persona-group">' +
      '<div class="persona-group-head">' +
      '<span class="eyebrow">' +
      esc(title) +
      "</span>" +
      '<em class="persona-group-count">' +
      items.length +
      "</em>" +
      '<span class="persona-group-note">' +
      esc(note) +
      "</span>" +
      "</div>" +
      cards +
      "</section>"
    );
  }

  function renderPersonas() {
    var list = $("#persona-list");
    var empty = $("#persona-empty");
    if (!list) return;
    var users = [];
    var npcs = [];
    db.personas.forEach(function (persona) {
      if (persona.type === "npc") npcs.push(persona);
      else users.push(persona);
    });
    if (!db.personas.length) {
      list.hidden = true;
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    list.hidden = false;
    if (empty) empty.hidden = true;
    list.innerHTML =
      personaGroupHtml("用户人设", "你自己", users) +
      personaGroupHtml("NPC 人设", "故事里的人", npcs);
    $$("[data-persona-id]", list).forEach(function (button) {
      button.addEventListener("click", function () {
        openPersonaEditor(button.dataset.personaId);
      });
    });
  }

  function personaFieldEl(key) {
    return PERSONA_FIELDS[key] ? $(PERSONA_FIELDS[key]) : null;
  }

  function syncPersonaChips(persona) {
    $$("[data-persona-type]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.personaType === persona.type);
    });
    $$("[data-persona-gender]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.personaGender === persona.gender);
    });
    var hint = $("#pe-type-hint");
    if (hint) {
      hint.textContent =
        persona.type === "npc"
          ? "故事里的角色。TA 想要什么、怕什么，往往就是情节的发动机。"
          : "你自己。写清楚你希望以什么样子进入故事。";
    }
  }

  function fillPersonaForm(persona) {
    Object.keys(PERSONA_FIELDS).forEach(function (key) {
      var el = personaFieldEl(key);
      if (el) el.value = persona[key] == null ? "" : String(persona[key]);
    });
    syncPersonaChips(persona);
    abilityChips();
    var del = $("#persona-delete");
    if (del) del.style.visibility = personaIsNew ? "hidden" : "visible";
    $$("#view-persona-edit textarea").forEach(function (area) {
      autoGrow(area);
    });
  }

  function personaTouched(persona) {
    var keys = ["name", "height", "weight", "age", "appearance", "personality", "figure", "inner", "history", "persona"];
    for (var i = 0; i < keys.length; i++) {
      if (String(persona[keys[i]] || "").trim()) return true;
    }
    if (personaAbilities(persona).length) return true;
    return false;
  }

  function ensurePersonaSaved() {
    if (!personaDraft) return;
    if (personaIsNew) {
      db.personas.push(personaDraft);
      personaIsNew = false;
      var del = $("#persona-delete");
      if (del) del.style.visibility = "visible";
      var title = $("#persona-edit-title");
      if (title) title.textContent = "编辑人设";
    }
    personaDraft.updatedAt = Date.now();
    persist(false);
  }

  function commitPersonaField(key, value) {
    if (!personaDraft) return;
    if (String(personaDraft[key] || "") === String(value)) return;
    personaDraft[key] = value;
    ensurePersonaSaved();
  }

  function openPersonaEditor(id, presetType) {
    updateAIReadyBadge();
    var persona = id ? personaById(id) : null;
    personaIsNew = !persona;
    if (!persona) {
      persona = {
        id: uid("p"),
        type: presetType === "npc" ? "npc" : "user",
        name: "",
        gender: "女",
        age: "",
        height: "",
        weight: "",
        appearance: "",
        personality: "",
        figure: "",
        abilities: [],
        inner: "",
        history: "",
        persona: "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
    personaDraft = persona;
    var title = $("#persona-edit-title");
    if (title) title.textContent = personaIsNew ? "新建人设" : "编辑人设";
    fillPersonaForm(persona);
    showScreen("persona-edit");
    var scroller = $("#view-persona-edit .editor-scroll");
    if (scroller) scroller.scrollTop = 0;
  }

  function closePersonaEditor() {
    if (personaDraft && !personaTouched(personaDraft)) {
      var index = db.personas.indexOf(personaDraft);
      if (index >= 0) db.personas.splice(index, 1);
    }
    personaDraft = null;
    persist(true);
    renderPersonas();
    showScreen("personas");
    setTabUI("personas");
  }

  function deletePersona() {
    var persona = personaDraft;
    if (!persona || personaIsNew) return;
    confirmDialog({
      title: "删除这个人设？",
      message:
        "「" +
        (String(persona.name || "").trim() || "未命名角色") +
        "」会从人设库移除。已经加入世界的 NPC 不会受影响。",
      confirmText: "删除"
    }).then(function (ok) {
      if (!ok) return;
      db.personas = db.personas.filter(function (item) {
        return item.id !== persona.id;
      });
      personaDraft = null;
      persist(true);
      renderPersonas();
      showScreen("personas");
      setTabUI("personas");
      showToast("已删除人设");
    });
  }

  function setPersonaType(type) {
    if (!personaDraft) return;
    var next = type === "npc" ? "npc" : "user";
    if (personaDraft.type === next) return;
    personaDraft.type = next;
    syncPersonaChips(personaDraft);
    ensurePersonaSaved();
  }

  function setPersonaGender(gender) {
    if (!personaDraft) return;
    if (personaDraft.gender === gender) return;
    personaDraft.gender = gender;
    syncPersonaChips(personaDraft);
    ensurePersonaSaved();
  }

  function initPersonas() {
    var add = $("#add-persona");
    if (add) {
      add.addEventListener("click", function () {
        openPersonaEditor(null, "user");
      });
    }
    var back = $("#persona-back");
    if (back) back.addEventListener("click", closePersonaEditor);
    var del = $("#persona-delete");
    if (del) del.addEventListener("click", deletePersona);

    $$("[data-persona-type]").forEach(function (button) {
      button.addEventListener("click", function () {
        setPersonaType(button.dataset.personaType);
      });
    });
    $$("[data-persona-gender]").forEach(function (button) {
      button.addEventListener("click", function () {
        setPersonaGender(button.dataset.personaGender);
      });
    });

    Object.keys(PERSONA_FIELDS).forEach(function (key) {
      var el = personaFieldEl(key);
      if (!el) return;
      el.addEventListener("input", function () {
        commitPersonaField(key, el.value);
        if (el.tagName === "TEXTAREA") autoGrow(el);
      });
      el.addEventListener("change", function () {
        commitPersonaField(key, el.value);
      });
    });

    var abilityAdd = $("#pe-ability-add");
    if (abilityAdd) abilityAdd.addEventListener("click", addCustomAbility);
    var abilityInput = $("#pe-ability-input");
    if (abilityInput) {
      abilityInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          addCustomAbility();
        }
      });
    }
    $$("[data-persona-ai]").forEach(function (button) {
      button.addEventListener("click", function () {
        runPersonaAI(button.dataset.personaAi);
      });
    });
    var generate = $("#persona-ai-generate");
    if (generate) generate.addEventListener("click", generatePersonaFromPrompt);
    var exportBtn = $("#export-personas");
    if (exportBtn) exportBtn.addEventListener("click", openPersonaExportSheet);

    renderPersonas();
  }

  /* ---------------- 人设：特殊能力 / AI / 导出 ---------------- */

  var PERSONA_ABILITIES = [
    "念力",
    "元素掌控",
    "治愈",
    "读心",
    "预言",
    "变形",
    "通灵",
    "瞬移",
    "时间停滞",
    "记忆读取",
    "机械改造",
    "无能力"
  ];

  function normalizeAbilityList(value) {
    var list = [];
    if (Array.isArray(value)) list = value;
    else if (typeof value === "string" && value.trim()) {
      list = value.split(/[、,，\/|]/);
    }
    var seen = {};
    var out = [];
    list.forEach(function (item) {
      var text = String(item == null ? "" : item).replace(/\s+/g, " ").trim();
      if (!text || text.length > 16 || seen[text]) return;
      seen[text] = true;
      out.push(text);
    });
    return out.slice(0, 8);
  }

  function personaAbilities(persona) {
    return normalizeAbilityList(persona && persona.abilities);
  }

  function abilityChips() {
    var box = $("#pe-abilities");
    if (!box) return;
    var current = personaDraft ? personaAbilities(personaDraft) : [];
    var list = PERSONA_ABILITIES.slice();
    current.forEach(function (name) {
      if (list.indexOf(name) < 0) list.push(name);
    });
    box.innerHTML = list
      .map(function (name) {
        var on = current.indexOf(name) >= 0;
        return (
          '<button class="ability-chip' +
          (on ? " is-active" : "") +
          '" type="button" data-ability="' +
          esc(name) +
          '" aria-pressed="' +
          (on ? "true" : "false") +
          '">' +
          esc(name) +
          "</button>"
        );
      })
      .join("");
    $$("[data-ability]", box).forEach(function (button) {
      button.addEventListener("click", function () {
        toggleAbility(button.dataset.ability);
      });
    });
  }

  function toggleAbility(name) {
    if (!personaDraft) return;
    var list = personaAbilities(personaDraft);
    var index = list.indexOf(name);
    if (index >= 0) {
      list.splice(index, 1);
    } else {
      if (list.length >= 8) {
        showToast("最多选 8 项能力");
        return;
      }
      list.push(name);
    }
    personaDraft.abilities = list;
    abilityChips();
    ensurePersonaSaved();
  }

  function addCustomAbility() {
    var input = $("#pe-ability-input");
    var value = input ? input.value.trim() : "";
    if (!value) {
      if (input) input.focus();
      return;
    }
    if (!personaDraft) return;
    var list = personaAbilities(personaDraft);
    if (list.indexOf(value) >= 0) {
      showToast("这一条已经在上面了");
    } else if (list.length >= 8) {
      showToast("最多选 8 项能力");
    } else {
      list.push(value);
      personaDraft.abilities = list;
      abilityChips();
      ensurePersonaSaved();
      showToast("已加入「" + value + "」");
    }
    if (input) input.value = "";
  }

  var PERSONA_AI_SCHEMA =
    '{"type":"user|npc","name":"","gender":"男|女|双性|无性","age":"","height":"","weight":"",' +
    '"abilities":["念力"],"appearance":"","personality":"","figure":"","inner":"","history":""}';

  function personaSystemPrompt() {
    return (
      "你是「界书」的角色设定助手，擅长写中文小说里立体、有欲望也有缺陷的人物。你只输出一个合法的 JSON 对象，不要输出 Markdown 代码围栏、解释、注释或任何前后缀。JSON 结构必须严格为：" +
      PERSONA_AI_SCHEMA +
      "。要求：type 只能是 user（用户本人）或 npc（故事里的角色）；gender 只能是 男、女、双性、无性 之一；age、height、weight 用字符串，只写数字（身高按 cm、体重按 kg）；abilities 从「念力、元素掌控、治愈、读心、预言、变形、通灵、瞬移、时间停滞、记忆读取、机械改造、无能力」里选 0-2 项，必要时可以自创 1 项；appearance 写外貌与惯常穿着，personality 写说话方式、脾气与软肋，figure 写身形与身体特征，inner 写愿望或执念，history 写改变过 TA 的经历；每个文本字段 60-160 字，要具体，不要空泛套话；所有字段都必须出现。"
    );
  }

  function personaForAI(persona) {
    return {
      type: persona.type || "user",
      name: persona.name || "",
      gender: persona.gender || "女",
      age: persona.age || "",
      height: persona.height || "",
      weight: persona.weight || "",
      abilities: personaAbilities(persona),
      appearance: persona.appearance || "",
      personality: persona.personality || "",
      figure: persona.figure || "",
      inner: persona.inner || "",
      history: persona.history || ""
    };
  }

  function normalizeAIPersona(payload) {
    var source =
      payload && payload.persona && typeof payload.persona === "object"
        ? payload.persona
        : payload;
    if (!source || typeof source !== "object") {
      throw new Error("AI 返回格式无法识别");
    }
    return {
      type: source.type === "npc" ? "npc" : "user",
      name: truncateText(stringValue(source.name || source.title), 20),
      gender: normalizeAIGender(source.gender),
      age: truncateText(stringValue(source.age), 12),
      height: truncateText(stringValue(source.height), 12),
      weight: truncateText(stringValue(source.weight), 12),
      abilities: normalizeAbilityList(source.abilities || source.ability),
      appearance: truncateText(stringValue(source.appearance || source.looks), 800),
      personality: truncateText(stringValue(source.personality || source.temper), 800),
      figure: truncateText(stringValue(source.figure || source.body), 800),
      inner: truncateText(stringValue(source.inner || source.desire), 800),
      history: truncateText(stringValue(source.history || source.past), 1200)
    };
  }

  function parseAIPersona(text) {
    return normalizeAIPersona(extractJSONObject(text));
  }

  var PERSONA_TEXT_KEYS = ["appearance", "personality", "figure", "inner", "history"];
  var PERSONA_TEXT_LABEL = {
    appearance: "外貌",
    personality: "性格",
    figure: "身材",
    inner: "内心",
    history: "过往"
  };

  function applyPersonaAI(result, mode) {
    if (!personaDraft) return;
    var draft = personaDraft;
    var overwrite = mode === "optimize" || mode === "generate";

    PERSONA_TEXT_KEYS.forEach(function (key) {
      var next = String(result[key] || "").trim();
      var current = String(draft[key] || "").trim();
      if (!next) return;
      if (overwrite) {
        draft[key] = next;
        return;
      }
      if (!current) {
        draft[key] = next;
        return;
      }
      if (mode === "expand" && current.indexOf(next.slice(0, 12)) < 0) {
        draft[key] = truncateText(
          current + "\n" + next,
          key === "history" ? 1200 : 800
        );
      }
    });

    if (result.name && (overwrite || !String(draft.name || "").trim())) {
      draft.name = result.name;
    }
    ["age", "height", "weight"].forEach(function (key) {
      if (result[key] && (overwrite || !String(draft[key] || "").trim())) {
        draft[key] = result[key];
      }
    });
    if (result.gender && (overwrite || !String(draft.gender || "").trim())) {
      draft.gender = result.gender;
    }
    if (result.type && (overwrite || mode === "fill")) {
      draft.type = result.type === "npc" ? "npc" : "user";
    }
    if (result.abilities && result.abilities.length) {
      draft.abilities = overwrite
        ? result.abilities.slice(0, 8)
        : normalizeAbilityList(personaAbilities(draft).concat(result.abilities));
    }

    ensurePersonaSaved();
    fillPersonaForm(draft);
    showToast(
      mode === "generate"
        ? "AI 已写好这份人设"
        : "AI 已" +
            (mode === "fill" ? "补全" : mode === "optimize" ? "优化" : "扩展") +
            "这份人设"
    );
  }

  var PERSONA_AI_LABELS = {
    fill: ["正在补全人设", "AI 正在想象 TA 还没写到的部分。"],
    optimize: ["正在润色人设", "AI 正在让文字更像一个活人。"],
    expand: ["正在扩展人设", "AI 正在为 TA 添上新的细节。"]
  };

  function personaAINeeded() {
    if (!isAIConfigured()) {
      showToast("请先接入 AI 模型");
      openSettings("persona-edit");
      return false;
    }
    return true;
  }

  function runPersonaAI(mode) {
    var draft = personaDraft;
    if (!draft || aiBusy) return;
    if (!personaAINeeded()) return;

    var instructions = {
      fill:
        "请在不覆盖已有内容的前提下，补全这个角色的空缺信息。已有字段保持原样；如果写定了名字就沿用；最终返回完整 JSON。",
      optimize:
        "请在保留既有事实与设定的前提下润色这个角色：让外貌、性格、身材、内心、过往更具体、更有画面感，删掉空泛的套话；不要改变 TA 的身份与经历；最终返回完整 JSON。",
      expand:
        "请在不推翻既有设定的前提下扩展这个角色：为外貌、性格、身材、内心、过往各补一段新的细节（新段落会接在原文后面），不要重复已有句子；最终返回完整 JSON。"
    };
    var promptInput = $("#persona-ai-prompt");
    var extra = promptInput ? promptInput.value.trim() : "";

    aiBusy = true;
    aiTaskInfo = {
      label: PERSONA_AI_LABELS[mode][0],
      doneTitle: "界书 · 人设已更新"
    };
    setAIActionsDisabled(true);
    showAILoading(PERSONA_AI_LABELS[mode][0], PERSONA_AI_LABELS[mode][1]);

    var content =
      instructions[mode] +
      "\n\n当前角色：\n" +
      JSON.stringify(personaForAI(draft), null, 2);
    if (extra) content += "\n\n补充要求：" + extra;

    aiChat(
      [
        { role: "system", content: personaSystemPrompt() },
        { role: "user", content: content }
      ],
      { temperature: mode === "optimize" ? 0.55 : 0.85, maxTokens: 2000 }
    )
      .then(function (text) {
        var result = parseAIPersona(text);
        applyPersonaAI(result, mode);
        finishAITaskUI(
          true,
          "「" +
            (String(draft.name || "").trim() || "这个角色") +
            "」的 " +
            (mode === "fill" ? "AI 填写" : mode === "optimize" ? "AI 优化" : "AI 扩展") +
            "已完成，结果已写回人设。"
        );
      })
      .catch(function (error) {
        if (isAICancelError(error)) {
          finishAITaskUI(false);
          return;
        }
        finishAITaskUI(false, "「" + (String(draft.name || "").trim() || "这个角色") + "」的 AI 写作没有完成。");
        alertDialog({
          title: "AI 没有完成这次写作",
          message: friendlyAIError(error),
          confirmText: "知道了"
        });
      });
  }

  function generatePersonaFromPrompt() {
    var input = $("#persona-ai-prompt");
    var prompt = input ? input.value.trim() : "";
    if (!prompt) {
      showToast("先写一句话");
      if (input) input.focus();
      return;
    }
    var draft = personaDraft;
    if (!draft || aiBusy) return;
    if (!personaAINeeded()) return;

    var start = function () {
      aiBusy = true;
      aiTaskInfo = {
        label: "正在造一个角色",
        doneTitle: "界书 · 角色已生成"
      };
      setAIActionsDisabled(true);
      showAILoading("正在造一个角色", "从一个念头里，长出一个具体的人。");
      aiChat(
        [
          { role: "system", content: personaSystemPrompt() },
          {
            role: "user",
            content:
              "请根据下面这句话造一个具体、能直接演的角色，把所有字段都写满（包括特殊能力）。\n一句话概念：" +
              prompt
          }
        ],
        { temperature: 0.92, maxTokens: 2000 }
      )
        .then(function (text) {
          var result = parseAIPersona(text);
          applyPersonaAI(result, "generate");
          if (input) input.value = "";
          finishAITaskUI(
            true,
            "新角色「" + (String(draft.name || "").trim() || prompt.slice(0, 12)) + "」已生成。"
          );
        })
        .catch(function (error) {
          if (isAICancelError(error)) {
            finishAITaskUI(false);
            return;
          }
          finishAITaskUI(false, "这次没有生成出新角色。");
          alertDialog({
            title: "这次没有生成成功",
            message: friendlyAIError(error),
            confirmText: "知道了"
          });
        });
    };

    if (personaTouched(draft) || String(draft.name || "").trim()) {
      confirmDialog({
        title: "用 AI 重写这份人设？",
        message: "生成会覆盖现在已经写下的文字。想保留的部分可以先复制出去。",
        confirmText: "继续生成"
      }).then(function (ok) {
        if (ok) start();
      });
      return;
    }
    start();
  }

  /* --- 全部人设导出 --- */

  function personaExportMeta(persona) {
    var measure = personaMeasure(persona);
    var type = personaTypeLabel(persona.type);
    return measure ? type + " · " + measure : type;
  }

  function personasDocParagraphs() {
    var out = [];
    var users = db.personas.filter(function (persona) {
      return persona.type !== "npc";
    });
    var npcs = db.personas.filter(function (persona) {
      return persona.type === "npc";
    });
    out.push(docxTitle("人设库"));
    out.push(docxNote("界书 · 人设设定 · " + worldDocStamp() + " 导出"));
    out.push(
      docxNote(
        "下面是这个人设库里的全部角色。把这份文档整段发给 AI，它就能按这些设定扮演角色，也可以把你写进故事里。"
      )
    );

    var index = 0;
    var pushPersona = function (persona) {
      index += 1;
      var name = String(persona.name || "").trim() || "未命名角色";
      var meta = personaExportMeta(persona);
      out.push(
        docxPara(index + "、" + name + (meta ? "（" + meta + "）" : ""), {
          bold: true,
          size: 23,
          before: 160,
          after: 70
        })
      );
      var abilities = personaAbilities(persona);
      if (abilities.length) out.push(docxBody("特殊能力：" + abilities.join("、")));
      PERSONA_TEXT_KEYS.forEach(function (key) {
        var text = String(persona[key] || "").trim();
        if (text) out.push(docxBody(PERSONA_TEXT_LABEL[key] + "：" + text));
      });
      var legacy = String(persona.persona || "").trim();
      if (legacy) out.push(docxBody("人物设定：" + legacy));
    };

    if (users.length) {
      out.push(docxHeading("一、用户人设"));
      users.forEach(pushPersona);
    }
    if (npcs.length) {
      out.push(docxHeading((users.length ? "二" : "一") + "、NPC 人设"));
      npcs.forEach(pushPersona);
    }
    out.push(docxNote("—— 完 ——"));
    return out;
  }

  function buildPersonasDocx() {
    var encoder = new TextEncoder();
    var entries = [
      { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
      { name: "_rels/.rels", data: encoder.encode(DOCX_RELS) },
      {
        name: "word/document.xml",
        data: encoder.encode(docxDocumentXml(personasDocParagraphs()))
      }
    ];
    return zipStore(entries);
  }

  function buildPersonasJson() {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "界书",
      scope: "personas",
      exportedAt: new Date().toISOString(),
      withApiKey: false,
      worlds: [],
      personas: JSON.parse(JSON.stringify(db.personas)),
      groups: []
    };
  }

  function personasExportName(ext) {
    return "界书-人设库-" + backupStamp() + "." + ext;
  }

  function exportPersonasDocx() {
    var bytes;
    try {
      bytes = buildPersonasDocx();
    } catch (err) {
      showToast("生成文档失败");
      return;
    }
    var fileName = personasExportName("docx");
    var bridge = window.AndroidBackup;
    if (bridge && typeof bridge.saveBase64 === "function") {
      window.__exportLabel = " Word 文档";
      try {
        bridge.saveBase64(bytesToBase64(bytes), fileName, DOCX_MIME);
        return;
      } catch (err) {
        window.__exportLabel = "";
      }
    }
    saveBlobFallback(bytes, DOCX_MIME, fileName);
  }

  function exportPersonasJson() {
    var text = JSON.stringify(buildPersonasJson(), null, 2);
    var fileName = personasExportName("json");
    var bridge = window.AndroidBackup;
    if (bridge && typeof bridge.save === "function") {
      window.__exportLabel = " JSON 文件";
      try {
        bridge.save(text, fileName);
        return;
      } catch (err) {
        window.__exportLabel = "";
      }
    }
    saveBlobFallback(new TextEncoder().encode(text), "application/json", fileName);
  }

  function openPersonaExportSheet() {
    var root = $("#sheet-root");
    if (!root) return;
    if (!db.personas.length) {
      showToast("人设库还是空的，先写一个角色");
      return;
    }
    var total = db.personas.length;
    var chevron =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="保存全部人设">' +
      '<div class="sheet-grab"></div>' +
      '<span class="eyebrow">EXPORT CHARACTERS</span>' +
      "<h3>保存全部人设</h3>" +
      '<p class="sheet-desc">把 ' +
      total +
      " 份人设保存成一个文件：Word 方便直接发给 AI，JSON 可以再导入回界书。</p>" +
      '<div class="backup-options">' +
      '<button class="backup-option" type="button" data-persona-export="docx">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13 3.5V8h4.5"/><path d="M9.2 12.4h5.6M9.2 15.4h5.6M9.2 18h3.4"/></svg></span>' +
      '<span class="bo-main"><strong>Word 文档（.docx）</strong><span>纯文字人设，发给 AI 就能开演</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      '<button class="backup-option" type="button" data-persona-export="json">' +
      '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5H7.8a2 2 0 0 0-2 2v3.2c0 1-.7 1.8-1.6 1.8.9 0 1.6.8 1.6 1.8v3.2a2 2 0 0 0 2 2h1.7"/><path d="M14.5 4.5h1.7a2 2 0 0 1 2 2v3.2c0 1 .7 1.8 1.6 1.8-.9 0-1.6.8-1.6 1.8v3.2a2 2 0 0 1-2 2h-1.7"/></svg></span>' +
      '<span class="bo-main"><strong>JSON 文件（.json）</strong><span>完整结构化数据，可再导入回界书</span></span>' +
      '<span class="bo-chev">' +
      chevron +
      "</span>" +
      "</button>" +
      "</div>" +
      '<p class="backup-tip">导入这个 JSON：顶栏「数据备份 → 从文件导入」，系统会把它当作一份只含人设的备份。</p>' +
      '<div class="sheet-actions">' +
      '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
      "</div></div>";

    requestAnimationFrame(function () {
      root.classList.add("open");
    });

    $$("[data-close-sheet]", root).forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });

    $$("[data-persona-export]", root).forEach(function (button) {
      button.addEventListener("click", function () {
        var kind = button.dataset.personaExport;
        closeSheet();
        setTimeout(function () {
          if (kind === "docx") exportPersonasDocx();
          else exportPersonasJson();
        }, 220);
      });
    });
  }

/* ---------------- 对话 ---------------- */

var CHAT_MODE_LABEL = { world: "世界观 × 用户人设", persona: "用户人设 × NPC 人设" };
var CHAT_DEFAULT_STATS = [
  { label: "生命值", value: "100" },
  { label: "精神值", value: "100" }
];
var chatBusy = false;
var activeChatId = null;
var chatComposerAttachments = [];
var chatEditingMessageId = null;
var chatUidSeq = 0;

function normalizeChatStats(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && typeof item === "object";
    })
    .slice(0, 12)
    .map(function (item) {
      var label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) return null;
      return {
        id: typeof item.id === "string" ? item.id : chatUid("s"),
        label: label.slice(0, 12),
        value: item.value == null ? "" : String(item.value).slice(0, 24)
      };
    })
    .filter(Boolean);
}

function normalizeChatAttachments(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && typeof item === "object";
    })
    .slice(0, 4)
    .map(function (item) {
      return {
        kind: item.kind === "image" ? "image" : "file",
        name: typeof item.name === "string" ? item.name : "附件",
        mime: typeof item.mime === "string" ? item.mime : "",
        data: typeof item.data === "string" ? item.data : "",
        text: typeof item.text === "string" ? item.text : ""
      };
    })
    .filter(function (item) {
      return item.kind === "image" ? !!item.data : !!item.text;
    });
}

function normalizeChatMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && typeof item === "object";
    })
    .map(function (item) {
      var message = {
        id: typeof item.id === "string" ? item.id : chatUid("m"),
        role: item.role === "ai" ? "ai" : "user",
        text: typeof item.text === "string" ? item.text : "",
        at: Number(item.at) || Date.now()
      };
      var attachments = normalizeChatAttachments(item.attachments);
      if (attachments.length) message.attachments = attachments;
      if (Array.isArray(item.changes) && item.changes.length) {
        message.changes = item.changes
          .filter(function (change) {
            return change && typeof change === "object";
          })
          .slice(0, 12)
          .map(function (change) {
            return {
              label: typeof change.label === "string" ? change.label : "状态",
              from: change.from == null ? "" : String(change.from),
              to: change.to == null ? "" : String(change.to)
            };
          });
      }
      return message;
    });
}

function normalizeChatGroups(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && typeof item === "object" && typeof item.id === "string" && item.id;
    })
    .map(function (item) {
      return {
        id: item.id,
        name: typeof item.name === "string" && item.name ? item.name : "未命名分组",
        createdAt: Number(item.createdAt) || Date.now()
      };
    });
}

function normalizeConversations(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (item) {
      return item && typeof item === "object";
    })
    .map(function (item) {
      var mode = item.mode === "persona" ? "persona" : "world";
      return {
        id: typeof item.id === "string" ? item.id : chatUid("chat"),
        title: typeof item.title === "string" ? item.title : "",
        mode: mode,
        worldId: typeof item.worldId === "string" ? item.worldId : "",
        userPersonaId: typeof item.userPersonaId === "string" ? item.userPersonaId : "",
        npcPersonaId: typeof item.npcPersonaId === "string" ? item.npcPersonaId : "",
        currency: typeof item.currency === "string" ? item.currency : "",
        currencyLabel: typeof item.currencyLabel === "string" ? item.currencyLabel : "货币",
        currencyConfig:
          item.currencyConfig && typeof item.currencyConfig === "object"
            ? item.currencyConfig
            : null,
        groupId: typeof item.groupId === "string" ? item.groupId : "",
        stats: normalizeChatStats(item.stats),
        panels: {
          currency: !!(item.panels && item.panels.currency),
          stats: !!(item.panels && item.panels.stats)
        },
        messages: normalizeChatMessages(item.messages),
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now()
      };
    });
}

function normalizeChatSettings(raw) {
  var data = raw && typeof raw === "object" ? raw : {};
  return {
    model: typeof data.model === "string" ? data.model : "",
    visionModel: typeof data.visionModel === "string" ? data.visionModel : "",
    minChars: Math.max(0, Math.min(2000, Number(data.minChars) || 0))
  };
}

function chatUid(prefix) {
  chatUidSeq += 1;
  return (prefix || "c") + "_" + Date.now().toString(36) + "_" + chatUidSeq;
}

function chatSettings() {
  var raw = db.chatSettings || {};
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    visionModel: typeof raw.visionModel === "string" ? raw.visionModel : "",
    minChars: Math.max(0, Math.min(2000, Number(raw.minChars) || 0))
  };
}

function chatModelLabel(model) {
  if (!model) {
    var ai = aiConfig();
    return (ai.modelName || ai.model || "默认模型") + "（跟设置一致）";
  }
  return model;
}

function chatById(id) {
  return db.conversations.filter(function (item) {
    return item.id === id;
  })[0];
}

function chatWorld(conv) {
  if (!conv || !conv.worldId) return null;
  return db.worlds.filter(function (world) {
    return world.id === conv.worldId;
  })[0] || null;
}

function chatPersona(id) {
  if (!id) return null;
  return db.personas.filter(function (persona) {
    return persona.id === id;
  })[0] || null;
}

function chatTitle(conv) {
  if (conv.title && conv.title.trim()) return conv.title.trim();
  var world = chatWorld(conv);
  var user = chatPersona(conv.userPersonaId);
  if (conv.mode === "world") {
    return (world ? displayWorldName(world) : "未选世界") + " · " + (user ? user.name || "我" : "我");
  }
  var npc = chatPersona(conv.npcPersonaId);
  return (user ? user.name || "我" : "我") + " × " + (npc ? npc.name || "NPC" : "NPC");
}

function chatSubtitle(conv) {
  var world = chatWorld(conv);
  var npc = chatPersona(conv.npcPersonaId);
  var parts = [CHAT_MODE_LABEL[conv.mode] || CHAT_MODE_LABEL.world];
  if (conv.mode === "persona" && npc) parts.push("AI 扮演 " + (npc.name || "NPC"));
  else if (world) parts.push("AI 担任 DM");
  return parts.join(" · ");
}

function chatLastPreview(conv) {
  var list = conv.messages || [];
  for (var i = list.length - 1; i >= 0; i -= 1) {
    var text = String(list[i].text || "").replace(/\s+/g, " ").trim();
    if (text) return (list[i].role === "user" ? "你：" : "") + text.slice(0, 46);
  }
  return "还没有开始对话";
}

function renderChats() {
  var list = $("#chat-list");
  var empty = $("#chat-empty");
  if (!list) return;
  var items = db.conversations.slice().sort(function (a, b) {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (empty) empty.classList.toggle("hidden", items.length > 0);
  list.innerHTML = items
    .map(function (conv) {
      var world = chatWorld(conv);
      var user = chatPersona(conv.userPersonaId);
      var av = conv.mode === "world" ? "界" : firstChar(user ? user.name : "我", "我");
      return (
        '<button class="chat-card" type="button" data-chat-id="' +
        esc(conv.id) +
        '">' +
        '<span class="chat-avatar">' +
        esc(av) +
        "</span>" +
        '<span class="chat-card-main">' +
        '<span class="chat-card-title">' +
        esc(chatTitle(conv)) +
        "</span>" +
        '<span class="chat-card-meta">' +
        esc(chatSubtitle(conv)) +
        "</span>" +
        '<span class="chat-card-last">' +
        esc(chatLastPreview(conv)) +
        "</span>" +
        "</span>" +
        '<span class="chat-card-side"><span class="chat-count">' +
        String((conv.messages || []).length) +
        "</span>" +
        (world && conv.panels && conv.panels.stats ? '<span class="chat-dot"></span>' : "") +
        "</span>" +
        "</button>"
      );
    })
    .join("");
  $$("[data-chat-id]", list).forEach(function (button) {
    button.addEventListener("click", function () {
      openChat(button.dataset.chatId);
    });
  });
}

/* ---- 新建对话 ---- */

function statRowHtml(stat, index) {
  return (
    '<div class="stat-edit-row" data-stat-row="' +
    index +
    '">' +
    '<input class="text-input stat-label" type="text" maxlength="8" placeholder="状态名" value="' +
    esc(stat.label || "") +
    '">' +
    '<input class="text-input stat-value" type="text" maxlength="12" placeholder="初始值" value="' +
    esc(stat.value || "") +
    '">' +
    '<button class="stat-remove" type="button" data-stat-remove="' +
    index +
    '" aria-label="移除">×</button>' +
    "</div>"
  );
}

function openNewChatSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  if (!db.worlds.length && !db.personas.length) {
    alertDialog({
      title: "还没有材料",
      message: "先在世界观里写一个世界，或者在「人设」里建一个你自己，再回来开对话。",
      confirmText: "知道了"
    });
    return;
  }
  var worldOptions = db.worlds
    .map(function (world) {
      return '<option value="' + esc(world.id) + '">' + esc(displayWorldName(world)) + "</option>";
    })
    .join("");
  var userOptions = db.personas
    .filter(function (p) {
      return p.type !== "npc";
    })
    .map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name || "未命名") + "</option>";
    })
    .join("");
  var npcOptions = db.personas
    .filter(function (p) {
      return p.type === "npc";
    })
    .map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name || "未命名") + "</option>";
    })
    .join("");

  var draftStats = CHAT_DEFAULT_STATS.map(function (s) {
    return { label: s.label, value: s.value };
  });

  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet chat-new-sheet" role="dialog" aria-modal="true" aria-label="新建对话">' +
    '<div class="sheet-grab"></div>' +
    "<h3>新建对话</h3>" +
    '<p class="sheet-desc">选一组角色，AI 会读取他们的设定，并把这个世界演下去。</p>' +
    '<div class="seg-row chat-mode-row">' +
    '<button class="seg is-active" type="button" data-chat-mode="world">世界观 × 用户人设</button>' +
    '<button class="seg" type="button" data-chat-mode="persona">用户人设 × NPC</button>' +
    "</div>" +
    '<div class="chat-field" data-mode-block="world">' +
    '<label class="field-label">世界观</label>' +
    (worldOptions
      ? '<select id="chat-world" class="text-input chat-select">' + worldOptions + "</select>"
      : '<p class="chat-warn">还没有世界观，先去建一个。</p>') +
    "</div>" +
    '<div class="chat-field">' +
    '<label class="field-label">你的角色（用户人设）</label>' +
    (userOptions
      ? '<select id="chat-user" class="text-input chat-select">' + userOptions + "</select>"
      : '<p class="chat-warn">还没有用户人设，先去人设页建一个。</p>') +
    "</div>" +
    '<div class="chat-field hidden" data-mode-block="persona">' +
    '<label class="field-label">AI 扮演（NPC 人设）</label>' +
    (npcOptions
      ? '<select id="chat-npc" class="text-input chat-select">' + npcOptions + "</select>"
      : '<p class="chat-warn">还没有 NPC 人设，先去建一个。</p>') +
    "</div>" +
    '<div class="chat-toggle-row">' +
    '<span><strong>显示货币</strong><small>这个世界怎么交换价值</small></span>' +
    '<input id="chat-panel-currency" class="bs-input" type="checkbox" checked>' +
    '<span class="bs-track"><span class="bs-thumb"></span></span>' +
    "</div>" +
    '<div class="chat-toggle-row">' +
    '<span><strong>显示人物状态</strong><small>数值变化会写在对话里</small></span>' +
    '<input id="chat-panel-stats" class="bs-input" type="checkbox" checked>' +
    '<span class="bs-track"><span class="bs-thumb"></span></span>' +
    "</div>" +
    '<div class="chat-stats-block" id="chat-stats-block">' +
    '<label class="field-label">状态栏（自己定要盯哪些值）</label>' +
    '<div id="chat-stat-rows">' +
    draftStats.map(statRowHtml).join("") +
    "</div>" +
    '<button class="mini-btn" type="button" id="chat-stat-add">+ 再加一项</button>' +
    "</div>" +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
    '<button class="btn primary" type="button" id="chat-create">开始对话</button>' +
    "</div></div>";

  requestAnimationFrame(function () {
    root.classList.add("open");
  });

  var mode = "world";
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-chat-mode]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      mode = button.dataset.chatMode;
      $$("[data-chat-mode]", root).forEach(function (other) {
        other.classList.toggle("is-active", other === button);
      });
      $$("[data-mode-block]", root).forEach(function (block) {
        block.classList.toggle("hidden", block.dataset.modeBlock !== mode);
      });
    });
  });

  var rowsHost = $("#chat-stat-rows", root);
  var collectRows = function () {
    return $$(".stat-edit-row", rowsHost).map(function (row) {
      return {
        label: $(".stat-label", row).value.trim(),
        value: $(".stat-value", row).value.trim()
      };
    });
  };
  var rerenderRows = function (stats) {
    rowsHost.innerHTML = stats.map(statRowHtml).join("");
    bindRowRemoves();
  };
  var bindRowRemoves = function () {
    $$("[data-stat-remove]", rowsHost).forEach(function (button) {
      button.addEventListener("click", function () {
        var rows = collectRows();
        rows.splice(Number(button.dataset.statRemove), 1);
        rerenderRows(rows);
      });
    });
  };
  bindRowRemoves();

  var sortedLabelSeq = 0;
  $("#chat-stat-add", root).addEventListener("click", function () {
    var rows = collectRows();
    sortedLabelSeq += 1;
    rows.push({ label: "", value: "0" });
    rerenderRows(rows);
    var inputs = $$(".stat-label", rowsHost);
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $("#chat-create", root).addEventListener("click", function () {
    var stats = collectRows().filter(function (item) {
      return item.label;
    });
    var spec = {
      mode: mode,
      worldId: mode === "world" ? ($("#chat-world", root) || {}).value || "" : "",
      userPersonaId: ($("#chat-user", root) || {}).value || "",
      npcPersonaId: mode === "persona" ? ($("#chat-npc", root) || {}).value || "" : "",
      currency: $("#chat-panel-currency", root).checked,
      statsPanel: $("#chat-panel-stats", root).checked,
      stats: stats
    };
    if (mode === "world" && !spec.worldId) {
      showToast("先选一个世界观");
      return;
    }
    if (!spec.userPersonaId) {
      showToast("先选你自己的角色");
      return;
    }
    if (mode === "persona" && !spec.npcPersonaId) {
      showToast("先选一个 NPC");
      return;
    }
    var world = chatWorld({ worldId: spec.worldId });
    var conv = {
      id: chatUid("chat"),
      title: "",
      mode: spec.mode,
      worldId: spec.worldId,
      userPersonaId: spec.userPersonaId,
      npcPersonaId: spec.npcPersonaId,
      currency: spec.mode === "world" && world ? world.currency || "" : "",
      currencyLabel: world ? "货币" : "共享物",
      stats: spec.stats.map(function (item) {
        return { id: chatUid("s"), label: item.label, value: item.value };
      }),
      panels: { currency: spec.currency, stats: spec.statsPanel },
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.conversations.push(conv);
    persist(true);
    closeSheet();
    setTimeout(function () {
      openChat(conv.id);
    }, 220);
  });
}

/* ---- 对话详情 ---- */

function openChat(id) {
  var conv = chatById(id);
  if (!conv) return;
  activeChatId = id;
  chatComposerAttachments = [];
  chatEditingMessageId = null;
  renderChat();
  showScreen("chat");
  setTabUI("chats");
  var scroller = $("#chat-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function closeChat() {
  activeChatId = null;
  renderChats();
  showScreen("chats");
  setTabUI("chats");
}

function chatMessageHtml(message, index, total) {
  var conv = chatById(activeChatId);
  var isUser = message.role === "user";
  var who = isUser ? "你" : conv && conv.mode === "persona" ? (chatPersona(conv.npcPersonaId) || {}).name || "TA" : "DM";
  var attachments = (message.attachments || [])
    .map(function (item) {
      return (
        '<span class="msg-attach">' +
        (item.kind === "image" ? "🖼 " : "📄 ") +
        esc(item.name || "附件") +
        "</span>"
      );
    })
    .join("");
  var changes = (message.changes || [])
    .map(function (item) {
      return (
        '<span class="msg-change">' +
        esc(item.label) +
        " " +
        esc(clipChange(item.from)) +
        " → " +
        esc(clipChange(item.to)) +
        "</span>"
      );
    })
    .join("");
  var tools = "";
  if (!isUser && index === total - 1) {
    tools =
      '<div class="msg-tools"><button class="msg-tool" type="button" data-chat-regen="' +
      esc(message.id) +
      '">重新生成</button></div>';
  }
  if (isUser) {
    tools =
      '<div class="msg-tools"><button class="msg-tool" type="button" data-chat-edit="' +
      esc(message.id) +
      '">编辑后重发</button></div>';
  }
  return (
    '<div class="msg ' +
    (isUser ? "is-user" : "is-ai") +
    '" data-msg-id="' +
    esc(message.id) +
    '">' +
    '<div class="msg-who">' +
    esc(who) +
    "</div>" +
    '<div class="msg-bubble">' +
    (attachments ? '<div class="msg-attaches">' + attachments + "</div>" : "") +
    '<div class="msg-text">' +
    esc(message.text || "").replace(/\n/g, "<br>") +
    "</div>" +
    (changes ? '<div class="msg-changes">' + changes + "</div>" : "") +
    "</div>" +
    tools +
    "</div>"
  );
}

function renderChat() {
  var conv = chatById(activeChatId);
  if (!conv) return;
  var title = $("#chat-title");
  var sub = $("#chat-sub");
  if (title) title.textContent = chatTitle(conv);
  if (sub) sub.textContent = chatSubtitle(conv);
  var panelBtn = $("#chat-panel-btn");
  if (panelBtn) {
    var hasPanel = (conv.panels && conv.panels.stats) || (conv.panels && conv.panels.currency);
    panelBtn.classList.toggle("hidden", !hasPanel);
  }
  var thread = $("#chat-thread");
  if (thread) {
    var messages = conv.messages || [];
    thread.innerHTML =
      (messages.length
        ? messages
            .map(function (message, index) {
              return chatMessageHtml(message, index, messages.length);
            })
            .join("")
        : '<div class="chat-intro"><strong>从一句话开始</strong><p>' +
          esc(chatSubtitle(conv)) +
          "<br>你可以描述动作、说话，或者问 TA 一个问题。</p></div>") + '<div class="chat-typing hidden" id="chat-typing"><i></i><i></i><i></i></div>';
  }
  bindMessageTools();
  renderComposerAttachments();
}

function clipChange(value) {
  var text = value == null ? "" : String(value);
  if (text.length <= 18) return text;
  return text.slice(0, 18) + "…";
}

function bindMessageTools() {
  var thread = $("#chat-thread");
  if (!thread) return;
  $$("[data-chat-regen]", thread).forEach(function (button) {
    button.addEventListener("click", function () {
      regenerateChatReply(button.dataset.chatRegen);
    });
  });
  $$("[data-chat-edit]", thread).forEach(function (button) {
    button.addEventListener("click", function () {
      startEditMessage(button.dataset.chatEdit);
    });
  });
}

function scrollChatToEnd() {
  var scroller = $("#chat-scroll");
  if (!scroller) return;
  requestAnimationFrame(function () {
    scroller.scrollTop = scroller.scrollHeight;
  });
}

/* ---- 提示词 ---- */

function chatWorldBlock(world) {
  if (!world) return "";
  var lines = ["【世界】" + displayWorldName(world)];
  if (world.description) lines.push("概述：" + world.description);
  if (world.region) lines.push("地区：" + world.region);
  if (world.currency) lines.push("货币与交换：" + world.currency);
  if (world.rules && world.rules.length) {
    lines.push("规则：");
    world.rules.forEach(function (rule, index) {
      lines.push(
        "  " + (index + 1) + "、" + (rule.title || "未命名规则") + (rule.content ? "：" + rule.content : "")
      );
    });
  }
  var others = (world.npcs || []).filter(function (npc) {
    return npc && npc.name;
  });
  if (others.length) {
    lines.push("世界里的其他人物：");
    others.forEach(function (npc) {
      lines.push(
        "  - " + npc.name + (npc.gender ? "（" + npc.gender : "") + (npc.age ? " · " + npc.age + " 岁）" : "）") + (npc.persona ? "：" + npc.persona : "")
      );
    });
  }
  return lines.join("\n");
}

function chatSystemPrompt(conv) {
  var settings = chatSettings();
  var world = chatWorld(conv);
  var user = chatPersona(conv.userPersonaId);
  var npc = chatPersona(conv.npcPersonaId);
  var parts = [];
  parts.push(
    "你是「界书」里的叙事引擎，和一个用户一起把故事演下去。你只输出一个 JSON 对象，不要 Markdown 代码围栏、不要解释。"
  );
  parts.push(
    'JSON 结构：{"reply":"给用户看的正文","currency":"（可选）变化后的货币描述","stats":[{"label":"生命值","value":"85","reason":"被刀划伤"}]}'
  );
  parts.push(
    "只有在这一轮故事里数值或货币真的发生变化时，才写 stats / currency；没变化就省略这两个键。stats 的 label 必须与下面「状态栏」里已有的名字一致。"
  );
  if (world) parts.push(chatWorldBlock(world));
  if (user) {
    parts.push(
      "【用户扮演的角色】" +
        (user.name || "我") +
        "\n" +
        personaBrief(user).replace(/^\n+/, "")
    );
    parts.push("用户就是上面这个角色，不要替 TA 说话、不要替 TA 做决定。");
  }
  if (conv.mode === "persona" && npc) {
    parts.push(
      "【你扮演的角色】" +
        (npc.name || "TA") +
        "\n" +
        personaBrief(npc).replace(/^\n+/, "")
    );
    parts.push(
      "以第一人称扮演这个角色：写 TA 的动作、表情、语气与台词。你没有全知视角，只知道 TA 该知道的事；不确定的事可以疑惑、试探或误会。"
    );
    parts.push("如果场景里出现了其他人物，让他们各自说话做事，但仍然不要替用户行动。");
    parts.push(
      "不许出戏：不要提到自己是 AI、模型、提示词或规则，不要用旁白解释剧情，也不要说任何不符合 TA 设定与处境的话。"
    );
    parts.push(
      "用户发来的文字里，中文圆括号（）中的内容是动作或神态（例如（我推门进来）），其余是 TA 说的话；请按这个约定理解，并在回复里同样用（）写 TA 的动作。"
    );
  } else {
    parts.push(
      "【你的身份】你是这个世界的 DM（叙事者兼所有 NPC）。用第二人称「你」描写用户所处的场景，让 NPC 各自说话做事，推动世界对用户的行动做出反应。"
    );
    parts.push("不要替用户做决定、不要写用户的心理活动，只写世界与 NPC 的回应。");
  }
  var panel = [];
  if (conv.panels && conv.panels.currency && (conv.currency || (world && world.currency))) {
    panel.push("货币：" + (conv.currency || (world && world.currency)));
  }
  if (conv.panels && conv.panels.stats && (conv.stats || []).length) {
    panel.push(
      "状态栏：" +
        conv.stats
          .map(function (stat) {
            return stat.label + " " + stat.value;
          })
          .join("、")
    );
  }
  if (panel.length) {
    parts.push("【当前状态】\n" + panel.join("\n"));
    parts.push(
      "叙事时请把这些数值当成真实约束：受伤、消耗、获得都会让它们变化，变化时在 stats 里给出新的数值，并在 reply 里自然地体现出来。"
    );
  }
  if (settings.minChars) {
    parts.push("reply 至少写 " + settings.minChars + " 个汉字，像小说一样有画面、有细节，不要一句话敷衍。");
  } else {
    parts.push("reply 写得有画面、有细节，像小说一样。");
  }
  return parts.join("\n\n");
}

function chatHistoryMessages(conv, uptoIndex) {
  var out = [];
  var list = conv.messages || [];
  var limit = typeof uptoIndex === "number" ? uptoIndex : list.length;
  for (var i = 0; i < limit; i += 1) {
    var message = list[i];
    if (message.role === "system") continue;
    var content = message.text || "";
    var images = (message.attachments || []).filter(function (item) {
      return item.kind === "image" && item.data;
    });
    if (images.length) {
      var parts = [];
      if (content) parts.push({ type: "text", text: content });
      images.forEach(function (item) {
        parts.push({ type: "image_url", image_url: { url: item.data } });
      });
      out.push({ role: message.role === "user" ? "user" : "assistant", content: parts });
    } else {
      var files = (message.attachments || []).filter(function (item) {
        return item.kind === "file" && item.text;
      });
      if (files.length) {
        content +=
          "\n\n【用户附带的文件】\n" +
          files
            .map(function (item) {
              return "《" + (item.name || "附件") + "》\n" + String(item.text).slice(0, 6000);
            })
            .join("\n\n");
      }
      out.push({ role: message.role === "user" ? "user" : "assistant", content: content });
    }
  }
  return out;
}

function parseChatReply(text) {
  var payload = null;
  try {
    payload = extractJSONObject(text);
  } catch (err) {
    payload = null;
  }
  if (payload && typeof payload.reply === "string" && payload.reply.trim()) {
    return {
      reply: payload.reply.trim(),
      currency: typeof payload.currency === "string" ? payload.currency.trim() : "",
      stats: Array.isArray(payload.stats) ? payload.stats : []
    };
  }
  return { reply: String(text || "").trim(), currency: "", stats: [] };
}

function applyChatStats(conv, payload) {
  var changes = [];
  var stats = Array.isArray(payload.stats) ? payload.stats : [];
  stats.forEach(function (item) {
    if (!item || !item.label) return;
    var label = String(item.label).trim();
    var value = item.value == null ? "" : String(item.value).trim();
    if (!value) return;
    var existing = (conv.stats || []).filter(function (stat) {
      return stat.label === label;
    })[0];
    if (!existing) {
      existing = { id: chatUid("s"), label: label, value: "" };
      conv.stats.push(existing);
    }
    if (existing.value !== value) {
      changes.push({ label: label, from: existing.value, to: value });
      existing.value = value;
    }
  });
  if (payload.currency && conv.panels && conv.panels.currency) {
    var before = conv.currency || "";
    if (before !== payload.currency) {
      changes.push({ label: conv.currencyLabel || "货币", from: before, to: payload.currency });
      conv.currency = payload.currency;
    }
  }
  return changes;
}

function setChatTyping(on) {
  var typing = $("#chat-typing");
  if (typing) typing.classList.toggle("hidden", !on);
  var send = $("#chat-send");
  if (send) send.disabled = on;
  chatBusy = on;
  if (on) scrollChatToEnd();
}

function runChatTurn(conv, history, options) {
  var opts = options || {};
  var settings = chatSettings();
  setChatTyping(true);
  var messages = [{ role: "system", content: chatSystemPrompt(conv) }].concat(history);
  if (opts.extraInstruction) {
    messages.push({ role: "system", content: opts.extraInstruction });
  }
  return aiChat(messages, {
    model: settings.model,
    temperature: 0.92,
    maxTokens: 2200,
    tag: "对话"
  })
    .then(function (text) {
      setChatTyping(false);
      var payload = parseChatReply(text);
      var message = {
        id: chatUid("m"),
        role: "ai",
        text: payload.reply,
        at: Date.now()
      };
      var changes = applyChatStats(conv, payload);
      if (changes.length) message.changes = changes;
      conv.messages.push(message);
      conv.updatedAt = Date.now();
      persist(true);
      renderChat();
      scrollChatToEnd();
      if (changes.length) {
        showToast("状态已更新：" + changes.map(function (item) {
          return item.label;
        }).join("、"));
      }
      return message;
    })
    .catch(function (error) {
      setChatTyping(false);
      if (isAICancelError && isAICancelError(error)) return;
      alertDialog({
        title: "这次没有回复成功",
        message: friendlyAIError ? friendlyAIError(error) : String(error && error.message ? error.message : error),
        confirmText: "知道了"
      });
    });
}

function sendChatMessage() {
  var conv = chatById(activeChatId);
  if (!conv || chatBusy) return;
  var input = $("#chat-input");
  if (!input) return;
  var text = input.value.trim();
  if (!text && !chatComposerAttachments.length) return;
  if (!isAIConfigured()) {
    alertDialog({
      title: "还没有配置 AI",
      message: "对话由你自己的模型来写。先去设置里填上 API Key 和模型。",
      confirmText: "去设置"
    }).then(function (ok) {
      if (ok) openSettings("chat");
    });
    return;
  }
  var hasImage = chatComposerAttachments.some(function (item) {
    return item.kind === "image";
  });
  if (hasImage) {
    var settings = chatSettings();
    if (!settings.visionModel) {
      alertDialog({
        title: "当前模型看不了图片",
        message: "你发的模型没设置识图能力。可以只发文字，或者到「对话设置 → 识图模型」里换一个能看图的模型。",
        confirmText: "知道了"
      });
      return;
    }
  }

  var attachments = chatComposerAttachments.slice();
  chatComposerAttachments = [];
  renderComposerAttachments();
  input.value = "";
  autoGrow(input);

  if (chatEditingMessageId) {
    var editId = chatEditingMessageId;
    chatEditingMessageId = null;
    var index = conv.messages.findIndex(function (message) {
      return message.id === editId;
    });
    if (index >= 0) {
      conv.messages.splice(index);
      var sendBtnAfterEdit = $("#chat-send");
      if (sendBtnAfterEdit) sendBtnAfterEdit.textContent = "发送";
      var edited = {
        id: chatUid("m"),
        role: "user",
        text: text,
        at: Date.now()
      };
      if (attachments.length) edited.attachments = attachments;
      conv.messages.push(edited);
      renderChat();
      conv.updatedAt = Date.now();
      persist(false);
      runChatTurn(conv, chatHistoryMessages(conv));
      return;
    }
  }

  var message = {
    id: chatUid("m"),
    role: "user",
    text: text,
    at: Date.now()
  };
  if (attachments.length) message.attachments = attachments;
  conv.messages.push(message);
  conv.updatedAt = Date.now();
  persist(false);
  renderChat();
  scrollChatToEnd();
  runChatTurn(conv, chatHistoryMessages(conv));
}

function regenerateChatReply(messageId) {
  var conv = chatById(activeChatId);
  if (!conv || chatBusy) return;
  var index = conv.messages.findIndex(function (message) {
    return message.id === messageId;
  });
  if (index < 0) return;
  conv.messages.splice(index);
  conv.updatedAt = Date.now();
  renderChat();
  persist(false);
  runChatTurn(conv, chatHistoryMessages(conv), {
    extraInstruction: "请重新写这一段回应：可以换一个切入角度，但必须接着上面的剧情，不要把故事讲回去。"
  });
}

function startEditMessage(messageId) {
  var conv = chatById(activeChatId);
  if (!conv) return;
  var message = conv.messages.filter(function (item) {
    return item.id === messageId;
  })[0];
  if (!message) return;
  chatEditingMessageId = messageId;
  var input = $("#chat-input");
  if (input) {
    input.value = message.text || "";
    input.focus();
    autoGrow(input);
  }
  var send = $("#chat-send");
  if (send) send.textContent = "重发";
  showToast("改好后点「重发」，后面的对话会重新生成");
}

function renderComposerAttachments() {
  var host = $("#composer-attach");
  if (!host) return;
  host.innerHTML = chatComposerAttachments
    .map(function (item, index) {
      return (
        '<span class="composer-chip">' +
        (item.kind === "image" ? "🖼 " : "📄 ") +
        esc(item.name || "附件") +
        '<button type="button" data-attach-remove="' +
        index +
        '" aria-label="移除">×</button></span>'
      );
    })
    .join("");
  host.classList.toggle("hidden", !chatComposerAttachments.length);
  $$("[data-attach-remove]", host).forEach(function (button) {
    button.addEventListener("click", function () {
      chatComposerAttachments.splice(Number(button.dataset.attachRemove), 1);
      renderComposerAttachments();
    });
  });
}

/* ---- 状态面板 ---- */

function openChatPanel() {
  var conv = chatById(activeChatId);
  if (!conv) return;
  var root = $("#sheet-root");
  if (!root) return;
  var rows = [];
  if (conv.panels && conv.panels.currency) {
    rows.push(
      '<div class="panel-row"><span class="panel-label">' +
        esc(conv.currencyLabel || "货币") +
        '</span><span class="panel-value">' +
        esc(conv.currency || "—") +
        "</span></div>"
    );
  }
  if (conv.panels && conv.panels.stats) {
    (conv.stats || []).forEach(function (stat) {
      rows.push(
        '<div class="panel-row"><span class="panel-label">' +
          esc(stat.label) +
          '</span><span class="panel-value">' +
          esc(stat.value || "—") +
          "</span></div>"
      );
    });
  }
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="当前状态">' +
    '<div class="sheet-grab"></div>' +
    "<h3>当前状态</h3>" +
    '<p class="sheet-desc">AI 会根据剧情改这些值，你也可以手动改。</p>' +
    '<div class="panel-list">' +
    (rows.join("") || '<p class="chat-warn">这一组对话没有开状态栏。</p>') +
    "</div>" +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>关闭</button>' +
    '<button class="btn primary" type="button" id="panel-edit">修改数值</button>' +
    "</div></div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $("#panel-edit", root).addEventListener("click", function () {
    closeSheet();
    setTimeout(openChatPanelEdit, 220);
  });
}

function openChatPanelEdit() {
  var conv = chatById(activeChatId);
  if (!conv) return;
  var root = $("#sheet-root");
  if (!root) return;
  var rowsHtml = "";
  if (conv.panels && conv.panels.currency) {
    rowsHtml +=
      '<div class="panel-edit-row"><label class="field-label">' +
      esc(conv.currencyLabel || "货币") +
      '</label><input class="text-input" id="panel-currency" type="text" value="' +
      esc(conv.currency || "") +
      '" placeholder="例如：记忆币 12"></div>';
  }
  if (conv.panels && conv.panels.stats) {
    conv.stats.forEach(function (stat, index) {
      rowsHtml +=
        '<div class="panel-edit-row" data-panel-stat="' +
        index +
        '"><label class="field-label">' +
        esc(stat.label) +
        '</label><input class="text-input panel-stat-value" type="text" value="' +
        esc(stat.value || "") +
        '"></div>';
    });
  }
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-grab"></div>' +
    "<h3>修改数值</h3>" +
    '<p class="sheet-desc">改完保存，AI 下一轮就会按新的数值继续。</p>' +
    rowsHtml +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
    '<button class="btn primary" type="button" id="panel-save">保存</button>' +
    "</div></div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $("#panel-save", root).addEventListener("click", function () {
    var currencyInput = $("#panel-currency", root);
    if (currencyInput) conv.currency = currencyInput.value.trim();
    $$(".panel-stat-value", root).forEach(function (input) {
      var row = input.closest("[data-panel-stat]");
      var index = Number(row.dataset.panelStat);
      if (conv.stats[index]) conv.stats[index].value = input.value.trim();
    });
    conv.updatedAt = Date.now();
    persist(true);
    closeSheet();
    showToast("数值已更新");
  });
}

/* ---- 附件 ---- */

function openChatMoreSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-grab"></div>' +
    "<h3>更多</h3>" +
    '<div class="backup-options">' +
    '<button class="backup-option" type="button" data-chat-action="image"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="5" width="16.8" height="14" rx="2.4"/><circle cx="9" cy="10.2" r="1.6"/><path d="M5.4 17.4 10 12.8l3 3 2.2-2.2 3.4 3.4"/></svg></span><span class="bo-main"><strong>发送图片</strong><span>让 AI 看看场景、人物或道具</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="file"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 3.6h7.2l4 4v12.8H6.4z"/><path d="M13.2 3.6v4.2h4.2"/><path d="M9.2 12.6h5.6M9.2 15.8h4"/></svg></span><span class="bo-main"><strong>发送文件</strong><span>把设定、文本交给 AI 读</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="settings"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/></svg></span><span class="bo-main"><strong>对话设置</strong><span>换对话模型、识图模型、最少字数</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="clear"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.4 13.6l5.2-5.2 3.4 3.4-5.2 5.2z"/><path d="M9.4 15.4 6.6 18.2a1.7 1.7 0 0 1-2.4-2.4l2.8-2.8"/><path d="M15.6 6.4l2 2"/></svg></span><span class="bo-main"><strong>清空这段对话</strong><span>保留设定，只删掉聊天记录</span></span></button>' +
    "</div>" +
    '<div class="sheet-actions"><button class="btn ghost" type="button" data-close-sheet>取消</button></div>' +
    "</div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-chat-action]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var action = button.dataset.chatAction;
      closeSheet();
      if (action === "image") setTimeout(function () { pickChatAttachment("image"); }, 220);
      if (action === "file") setTimeout(function () { pickChatAttachment("file"); }, 220);
      if (action === "settings") setTimeout(openChatSettings, 220);
      if (action === "clear") setTimeout(clearChatMessages, 220);
    });
  });
}

function pickChatAttachment(kind) {
  if (window.AndroidChat && typeof window.AndroidChat.pick === "function") {
    try {
      window.AndroidChat.pick(kind);
      return;
    } catch (err) {}
  }
  var input = $("#chat-file");
  if (!input) return;
  input.dataset.kind = kind;
  input.accept = kind === "image" ? "image/*" : "text/*,.md,.json,.txt,.csv";
  input.value = "";
  input.click();
}

function readFileAsAttachment(file, kind) {
  return new Promise(function (resolve) {
    if (!file) return resolve(null);
    var reader = new FileReader();
    if (kind === "image") {
      reader.onload = function () {
        resolve({ kind: "image", name: file.name || "图片", mime: file.type || "image/png", data: String(reader.result) });
      };
      reader.readAsDataURL(file);
      return;
    }
    if (/^text\//.test(file.type) || /\.(txt|md|json|csv)$/i.test(file.name || "")) {
      reader.onload = function () {
        resolve({ kind: "file", name: file.name || "文件", mime: file.type || "text/plain", text: String(reader.result) });
      };
      reader.readAsText(file);
      return;
    }
    resolve({ kind: "file", name: file.name || "文件", mime: file.type || "", text: "" });
  });
}

window.onChatAttachmentPicked = function (payload) {
  var data = null;
  try {
    data = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch (err) {
    data = null;
  }
  if (!data) return;
  if (data.error) {
    showToast(data.error);
    return;
  }
  if (data.kind === "image" && !chatSettings().visionModel) {
    showToast("当前模型看不了图片，先到对话设置里选识图模型");
    return;
  }
  if (data.kind === "file" && !data.text) {
    showToast("这个文件不是纯文本，AI 读不了");
    return;
  }
  chatComposerAttachments.push(data);
  renderComposerAttachments();
  showToast("已添加「" + (data.name || "附件") + "」");
};

/* ---- 对话设置 ---- */

function openChatSettings(returnToChat) {
  chatSettingsReturnTo = returnToChat !== false ? "chat" : "chats";
  renderChatSettings();
  showScreen("chat-settings");
  setTabUI("chats");
}

function closeChatSettings() {
  if (chatSettingsReturnTo === "chat" && activeChatId) {
    renderChat();
    showScreen("chat");
    setTabUI("chats");
  } else {
    showScreen("chats");
    setTabUI("chats");
    renderChats();
  }
}

var chatSettingsReturnTo = "chat";

function renderChatSettings() {
  var settings = chatSettings();
  var ai = aiConfig();
  var models = (ai.models || []).map(function (model) {
    return (
      '<option value="' + esc(model.id) + '">' + esc(model.name || model.id) + "</option>"
    );
  }).join("");
  var modelSelect = $("#chat-model");
  var visionSelect = $("#chat-vision");
  if (modelSelect) {
    modelSelect.innerHTML =
      '<option value="">跟设置一致（' + esc(ai.modelName || ai.model || "未配置") + "）</option>" + models;
    modelSelect.value = settings.model || "";
  }
  if (visionSelect) {
    visionSelect.innerHTML =
      '<option value="">不启用识图</option><option value="__same__">与对话模型相同</option>' + models;
    visionSelect.value = settings.visionModel || "";
  }
  var minInput = $("#chat-minchars");
  if (minInput) minInput.value = String(settings.minChars);
  var badge = $("#chat-key-badge");
  if (badge) {
    badge.textContent = isAIConfigured() ? "已接入 · " + (ai.modelName || ai.model) : "未配置";
  }
}

function initChatSettings() {
  var back = $("#chat-settings-back");
  if (back) back.addEventListener("click", closeChatSettings);
  var modelSelect = $("#chat-model");
  if (modelSelect) {
    modelSelect.addEventListener("change", function () {
      db.chatSettings.model = modelSelect.value;
      persist(true);
      showToast("对话模型已更新");
    });
  }
  var visionSelect = $("#chat-vision");
  if (visionSelect) {
    visionSelect.addEventListener("change", function () {
      db.chatSettings.visionModel = visionSelect.value === "__same__" ? "" : visionSelect.value;
      persist(true);
    });
  }
  var minInput = $("#chat-minchars");
  if (minInput) {
    minInput.addEventListener("change", function () {
      var value = Math.max(0, Math.min(2000, Number(minInput.value) || 0));
      minInput.value = String(value);
      db.chatSettings.minChars = value;
      persist(true);
    });
  }
  var keyBtn = $("#chat-key-goto");
  if (keyBtn) {
    keyBtn.addEventListener("click", function () {
      openSettings("chat-settings");
    });
  }
}

/* ---- 其他 ---- */

function clearChatMessages() {
  var conv = chatById(activeChatId);
  if (!conv) return;
  confirmDialog({
    title: "清空这段对话？",
    message: "聊天记录会全部删掉，世界观、人设和状态栏保留。",
    confirmText: "清空"
  }).then(function (ok) {
    if (!ok) return;
    conv.messages = [];
    conv.updatedAt = Date.now();
    persist(true);
    renderChat();
    showToast("对话已清空");
  });
}

function deleteChat(id) {
  var conv = chatById(id);
  if (!conv) return;
  confirmDialog({
    title: "删除这组对话？",
    message: "「" + chatTitle(conv) + "」里的聊天记录会一起删掉。",
    confirmText: "删除"
  }).then(function (ok) {
    if (!ok) return;
    db.conversations = db.conversations.filter(function (item) {
      return item.id !== id;
    });
    persist(true);
    renderChats();
    showToast("已删除对话");
  });
}

/* ================= 对话 v2：分组 / 多选 / 导出 / 货币 / 键盘 ================= */

var chatSelIds = [];
var chatSelecting = false;
var chatPressTimer = null;
var chatPressMoved = false;

window.jieshuOpenWorldsExport = function () {
  openWorldsExportSheet();
};

window.jieshuOpenChatsExport = function () {
  openChatsExportSheet(db.conversations.slice(), "保存全部对话");
};

function chatGroupList() {
  if (!Array.isArray(db.chatGroups)) db.chatGroups = [];
  return db.chatGroups;
}

function chatGroupOf(conv) {
  if (!conv || !conv.groupId) return null;
  var list = chatGroupList();
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === conv.groupId) return list[i];
  }
  return null;
}

/* 默认不限制字数：调用方的 minChars 缺省就按 0 处理 */
function chatSettings() {
  var raw = db.chatSettings || {};
  var min = raw.minChars == null || raw.minChars === "" ? 0 : Number(raw.minChars);
  if (!isFinite(min)) min = 0;
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    visionModel: typeof raw.visionModel === "string" ? raw.visionModel : "",
    minChars: Math.max(0, Math.min(2000, Math.round(min)))
  };
}

function chatCurrencyTrimNumber(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return "";
  var text = n >= 1 ? String(Math.round(n * 1000) / 1000) : String(Math.round(n * 10000) / 10000);
  return text.indexOf(".") >= 0 ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/* 统一的货币结构：{ primary: "元", items: [{id, name: "金币", rate: 100}] }
   rate = 1 单位该货币折合多少主货币。兼容旧的 {name, sub, rate}（1 主 = rate 辅）。 */
function chatCurrencyConfig(conv) {
  var cfg = conv && conv.currencyConfig ? conv.currencyConfig : {};
  var primary = typeof cfg.primary === "string" ? cfg.primary.trim() : "";
  if (!primary && typeof cfg.name === "string") primary = cfg.name.trim();
  if (!primary) return null;
  var items = [];
  if (Array.isArray(cfg.items)) {
    cfg.items.forEach(function (item) {
      var name = item && typeof item.name === "string" ? item.name.trim() : "";
      var rate = Number(item && item.rate);
      if (name && isFinite(rate) && rate > 0 && name !== primary) {
        items.push({ id: (item && item.id) || "", name: name, rate: rate });
      }
    });
  } else if (cfg.sub && Number(cfg.rate) > 0) {
    items.push({ id: "", name: String(cfg.sub).trim(), rate: 1 / Number(cfg.rate) });
  }
  return { primary: primary, items: items };
}

function chatCurrencyRule(conv) {
  var cfg = chatCurrencyConfig(conv);
  if (!cfg || !cfg.items.length) return "";
  return cfg.items
    .map(function (item) {
      return "1 " + item.name + " = " + chatCurrencyTrimNumber(item.rate) + " " + cfg.primary;
    })
    .join(" · ");
}

/* ---- 列表 ---- */

function chatCardHtml(conv) {
  var world = chatWorld(conv);
  var user = chatPersona(conv.userPersonaId);
  var av = conv.mode === "world" ? "界" : firstChar(user ? user.name : "我", "我");
  var selected = chatSelIds.indexOf(conv.id) >= 0;
  return (
    '<button class="chat-card' +
    (selected ? " is-selected" : "") +
    '" type="button" data-chat-id="' +
    esc(conv.id) +
    '">' +
    (chatSelecting ? '<span class="chat-check' + (selected ? " is-on" : "") + '"></span>' : "") +
    '<span class="chat-avatar">' +
    esc(av) +
    "</span>" +
    '<span class="chat-card-main">' +
    '<span class="chat-card-title">' +
    esc(chatTitle(conv)) +
    "</span>" +
    '<span class="chat-card-meta">' +
    esc(chatSubtitle(conv)) +
    "</span>" +
    '<span class="chat-card-last">' +
    esc(chatLastPreview(conv)) +
    "</span>" +
    "</span>" +
    '<span class="chat-card-side"><span class="chat-count">' +
    String((conv.messages || []).length) +
    "</span>" +
    (world && conv.panels && conv.panels.stats ? '<span class="chat-dot"></span>' : "") +
    "</span>" +
    "</button>"
  );
}

function renderChats() {
  var list = $("#chat-list");
  var empty = $("#chat-empty");
  var bar = $("#chat-selbar");
  if (!list) return;
  var items = db.conversations.slice().sort(function (a, b) {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (empty) empty.classList.toggle("hidden", items.length > 0);
  if (bar) bar.hidden = !chatSelecting;
  var count = $("#chat-sel-count");
  if (count) count.textContent = "已选 " + chatSelIds.length;

  var html = "";
  var used = {};
  chatGroupList().forEach(function (group) {
    var groupItems = items.filter(function (conv) {
      return conv.groupId === group.id;
    });
    if (!groupItems.length) return;
    used[group.id] = true;
    html +=
      '<div class="chat-group"><div class="chat-group-head"><span>' +
      esc(group.name) +
      "</span><em>" +
      groupItems.length +
      " 段</em></div>" +
      groupItems.map(chatCardHtml).join("") +
      "</div>";
  });
  var rest = items.filter(function (conv) {
    return !conv.groupId || !used[conv.groupId];
  });
  if (rest.length) {
    if (chatGroupList().length) {
      html +=
        '<div class="chat-group"><div class="chat-group-head is-plain"><span>未分组</span><em>' +
        rest.length +
        " 段</em></div>" +
        rest.map(chatCardHtml).join("") +
        "</div>";
    } else {
      html += rest.map(chatCardHtml).join("");
    }
  }
  list.innerHTML = html;

  $$("[data-chat-id]", list).forEach(function (button) {
    var id = button.dataset.chatId;
    var timer = null;
    var moved = false;

    var startPoint = null;
    var startPress = function (point) {
      if (chatSelecting) return;
      moved = false;
      startPoint = point || null;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (moved) return;
        chatSelecting = true;
        chatSelIds = [id];
        renderChats();
      }, 480);
    };
    var movePress = function (point) {
      if (!startPoint || !point) return;
      var dx = Math.abs(point.x - startPoint.x);
      var dy = Math.abs(point.y - startPoint.y);
      if (dx > 10 || dy > 10) {
        moved = true;
        if (timer) clearTimeout(timer);
      }
    };
    var endPress = function () {
      if (timer) clearTimeout(timer);
    };
    button.addEventListener("pointerdown", function (event) {
      startPress({ x: event.clientX, y: event.clientY });
    });
    button.addEventListener("pointermove", function (event) {
      movePress({ x: event.clientX, y: event.clientY });
    });
    button.addEventListener("touchstart", function (event) {
      var touch = event.touches && event.touches[0];
      if (touch) startPress({ x: touch.clientX, y: touch.clientY });
    }, { passive: true });
    button.addEventListener("touchmove", function (event) {
      var touch = event.touches && event.touches[0];
      if (touch) movePress({ x: touch.clientX, y: touch.clientY });
    }, { passive: true });
    ["pointerup", "pointercancel", "pointerleave", "touchend", "touchcancel"].forEach(function (name) {
      button.addEventListener(name, endPress);
    });
    button.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      if (chatSelecting) return;
      chatSelecting = true;
      chatSelIds = [id];
      renderChats();
    });
    button.addEventListener("click", function () {
      if (timer) clearTimeout(timer);
      if (chatSelecting) {
        var at = chatSelIds.indexOf(id);
        if (at >= 0) chatSelIds.splice(at, 1);
        else chatSelIds.push(id);
        renderChats();
        return;
      }
      openChat(id);
    });
  });
}

function endChatSelect() {
  chatSelecting = false;
  chatSelIds = [];
  renderChats();
}

function groupSelectedChats() {
  if (!chatSelIds.length) {
    showToast("先选几段对话");
    return;
  }
  var groups = chatGroupList();
  promptDialog({
    title: "归为一组",
    message: "选中的 " + chatSelIds.length + " 段对话会被放进同一个分组；写一个已有的组名就直接进那个组。",
    label: "组名",
    value: groups.length ? groups[groups.length - 1].name : "",
    placeholder: "例如：雾海回响 · 主线"
  }).then(function (name) {
    if (!name) return;
    var target = null;
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].name === name) target = groups[i];
    }
    if (!target) {
      target = { id: chatUid("cg"), name: name, createdAt: Date.now() };
      groups.push(target);
    }
    db.conversations.forEach(function (conv) {
      if (chatSelIds.indexOf(conv.id) >= 0) conv.groupId = target.id;
    });
    persist(true);
    var n = chatSelIds.length;
    endChatSelect();
    showToast("已把 " + n + " 段对话归到「" + name + "」");
  });
}

function deleteSelectedChats() {
  if (!chatSelIds.length) {
    showToast("先选几段对话");
    return;
  }
  var ids = chatSelIds.slice();
  confirmDialog({
    title: "删除对话",
    message: "选中的 " + ids.length + " 段对话会被一起删掉，删掉就找不回来了。",
    confirmText: "删除"
  }).then(function (ok) {
    if (!ok) return;
    db.conversations = db.conversations.filter(function (conv) {
      return ids.indexOf(conv.id) < 0;
    });
    if (ids.indexOf(activeChatId) >= 0) activeChatId = null;
    persist(true);
    endChatSelect();
    showToast("已删除 " + ids.length + " 段对话");
  });
}

/* ---- 导出 ---- */

function chatTimeText(ts) {
  var date = new Date(Number(ts) || Date.now());
  var pad = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return (
    date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " +
    pad(date.getHours()) + ":" + pad(date.getMinutes())
  );
}

function chatExportParagraphs(convs) {
  var out = [];
  var single = convs.length === 1;
  out.push(docxTitle(single ? chatTitle(convs[0]) : "对话记录"));
  out.push(docxNote("界书 · 对话记录 · " + worldDocStamp() + " 导出"));
  if (single) {
    out.push(docxNote(chatSubtitle(convs[0]) + " · 共 " + (convs[0].messages || []).length + " 条"));
  } else {
    out.push(docxNote("共 " + convs.length + " 段对话。"));
  }
  convs.forEach(function (conv, index) {
    if (!single) {
      out.push(docxHeading(index + 1 + "、" + chatTitle(conv)));
      out.push(docxNote(chatSubtitle(conv) + " · " + chatTimeText(conv.updatedAt)));
    }
    var rule = chatCurrencyRule(conv);
    if (rule) out.push(docxNote("货币：" + (conv.currency || "—") + "（" + rule + "）"));
    else if (conv.panels && conv.panels.currency && conv.currency) {
      out.push(docxNote("货币：" + conv.currency));
    }
    if (conv.panels && conv.panels.stats && (conv.stats || []).length) {
      out.push(
        docxNote(
          "状态：" +
            conv.stats
              .map(function (stat) {
                return stat.label + " " + stat.value;
              })
              .join("、")
        )
      );
    }
    (conv.messages || []).forEach(function (message) {
      var isUser = message.role === "user";
      var who = isUser
        ? "我"
        : conv.mode === "persona"
        ? (chatPersona(conv.npcPersonaId) || {}).name || "TA"
        : "DM";
      out.push(docxBody(who + "：" + (message.text || "")));
      (message.attachments || []).forEach(function (item) {
        out.push(docxNote("（附件：" + (item.name || "文件") + "）"));
      });
      (message.changes || []).forEach(function (item) {
        out.push(docxNote("· " + item.label + " " + (item.from == null ? "" : item.from) + " → " + item.to));
      });
    });
  });
  out.push(docxNote("—— 完 ——"));
  return out;
}

function buildChatsDocx(convs) {
  var encoder = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(DOCX_RELS) },
    { name: "word/document.xml", data: encoder.encode(docxDocumentXml(chatExportParagraphs(convs))) }
  ]);
}

function buildChatsJson(convs) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: "界书",
    scope: convs.length === 1 ? "chat" : "chats",
    exportedAt: new Date().toISOString(),
    withApiKey: false,
    worlds: [],
    personas: [],
    groups: [],
    conversations: JSON.parse(JSON.stringify(convs))
  };
}

function chatsExportName(convs, ext) {
  var base = convs.length === 1 ? chatTitle(convs[0]) : "对话记录";
  base = String(base).replace(/[\\/:*?"<>|]/g, "").slice(0, 24) || "对话记录";
  return "界书-" + base + "-" + backupStamp() + "." + ext;
}

function exportChatsDocx(convs) {
  var bytes;
  try {
    bytes = buildChatsDocx(convs);
  } catch (err) {
    showToast("生成文档失败");
    return;
  }
  var fileName = chatsExportName(convs, "docx");
  var bridge = window.AndroidBackup;
  if (bridge && typeof bridge.saveBase64 === "function") {
    window.__exportLabel = " Word 文档";
    try {
      bridge.saveBase64(bytesToBase64(bytes), fileName, DOCX_MIME);
      return;
    } catch (err) {
      window.__exportLabel = "";
    }
  }
  saveBlobFallback(bytes, DOCX_MIME, fileName);
}

function exportChatsJson(convs) {
  var text = JSON.stringify(buildChatsJson(convs), null, 2);
  var fileName = chatsExportName(convs, "json");
  var bridge = window.AndroidBackup;
  if (bridge && typeof bridge.save === "function") {
    window.__exportLabel = " JSON 文件";
    try {
      bridge.save(text, fileName);
      return;
    } catch (err) {
      window.__exportLabel = "";
    }
  }
  saveBlobFallback(new TextEncoder().encode(text), "application/json", fileName);
}

function openChatsExportSheet(convs, title) {
  var root = $("#sheet-root");
  if (!root) return;
  if (!convs || !convs.length) {
    showToast("还没有对话可以保存");
    return;
  }
  var chevron =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  var messages = convs.reduce(function (sum, conv) {
    return sum + (conv.messages || []).length;
  }, 0);
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="保存对话">' +
    '<div class="sheet-grab"></div>' +
    '<span class="eyebrow">EXPORT CONVERSATIONS</span>' +
    "<h3>" + esc(title || "保存对话") + "</h3>" +
    '<p class="sheet-desc">' +
    (convs.length === 1 ? "这一组对话" : convs.length + " 段对话、共 " + messages + " 条消息") +
    "：Word 适合存档和发给 AI 接着演，JSON 是完整的原始数据。</p>" +
    '<div class="backup-options">' +
    '<button class="backup-option" type="button" data-chats-export="docx">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13 3.5V8h4.5"/><path d="M9.2 12.4h5.6M9.2 15.4h5.6M9.2 18h3.4"/></svg></span>' +
    '<span class="bo-main"><strong>Word 文档（.docx）</strong><span>按时间顺序的完整对话</span></span>' +
    '<span class="bo-chev">' + chevron + "</span></button>" +
    '<button class="backup-option" type="button" data-chats-export="json">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5H7.8a2 2 0 0 0-2 2v3.2c0 1-.7 1.8-1.6 1.8.9 0 1.6.8 1.6 1.8v3.2a2 2 0 0 0 2 2h1.7"/><path d="M14.5 4.5h1.7a2 2 0 0 1 2 2v3.2c0 1 .7 1.8 1.6 1.8-.9 0-1.6.8-1.6 1.8v3.2a2 2 0 0 1-2 2h-1.7"/></svg></span>' +
    '<span class="bo-main"><strong>JSON 文件（.json）</strong><span>结构化数据，含数值与附件信息</span></span>' +
    '<span class="bo-chev">' + chevron + "</span></button>" +
    "</div>" +
    '<div class="sheet-actions"><button class="btn ghost" type="button" data-close-sheet>取消</button></div>' +
    "</div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-chats-export]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.dataset.chatsExport;
      closeSheet();
      setTimeout(function () {
        if (kind === "docx") exportChatsDocx(convs);
        else exportChatsJson(convs);
      }, 240);
    });
  });
}

/* ---- 只保存世界观 ---- */

function worldsDocParagraphs(list) {
  var out = [];
  out.push(docxTitle("世界观集"));
  out.push(docxNote("界书 · 世界观设定 · " + worldDocStamp() + " 导出 · 共 " + list.length + " 个世界"));
  list.forEach(function (world) {
    out = out.concat(worldParagraphs(world));
  });
  out.push(docxNote("—— 完 ——"));
  return out;
}

function buildWorldsDocx(list) {
  var encoder = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(DOCX_RELS) },
    { name: "word/document.xml", data: encoder.encode(docxDocumentXml(worldsDocParagraphs(list))) }
  ]);
}

function buildWorldsJson(list) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: "界书",
    scope: "worlds",
    exportedAt: new Date().toISOString(),
    withApiKey: false,
    worlds: JSON.parse(JSON.stringify(list)),
    personas: [],
    groups: []
  };
}

function worldsExportName(ext) {
  return "界书-世界观-" + backupStamp() + "." + ext;
}

function exportWorldsDocx() {
  var list = db.worlds.slice();
  if (!list.length) {
    showToast("还没有世界观");
    return;
  }
  var bytes;
  try {
    bytes = buildWorldsDocx(list);
  } catch (err) {
    showToast("生成文档失败");
    return;
  }
  var fileName = worldsExportName("docx");
  var bridge = window.AndroidBackup;
  if (bridge && typeof bridge.saveBase64 === "function") {
    window.__exportLabel = " Word 文档";
    try {
      bridge.saveBase64(bytesToBase64(bytes), fileName, DOCX_MIME);
      return;
    } catch (err) {
      window.__exportLabel = "";
    }
  }
  saveBlobFallback(bytes, DOCX_MIME, fileName);
}

function exportWorldsJson() {
  var list = db.worlds.slice();
  if (!list.length) {
    showToast("还没有世界观");
    return;
  }
  var text = JSON.stringify(buildWorldsJson(list), null, 2);
  var fileName = worldsExportName("json");
  var bridge = window.AndroidBackup;
  if (bridge && typeof bridge.save === "function") {
    window.__exportLabel = " JSON 文件";
    try {
      bridge.save(text, fileName);
      return;
    } catch (err) {
      window.__exportLabel = "";
    }
  }
  saveBlobFallback(new TextEncoder().encode(text), "application/json", fileName);
}

function openWorldsExportSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  if (!db.worlds.length) {
    showToast("还没有世界观");
    return;
  }
  var chevron =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="保存世界观">' +
    '<div class="sheet-grab"></div>' +
    '<span class="eyebrow">EXPORT WORLDS</span>' +
    "<h3>保存全部世界观</h3>" +
    '<p class="sheet-desc">共 ' + db.worlds.length + ' 个世界，只导出世界观本身（不含人设与对话）。</p>' +
    '<div class="backup-options">' +
    '<button class="backup-option" type="button" data-worlds-export="docx">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13 3.5V8h4.5"/><path d="M9.2 12.4h5.6M9.2 15.4h5.6M9.2 18h3.4"/></svg></span>' +
    '<span class="bo-main"><strong>Word 文档（.docx）</strong><span>纯文字设定，可直接发给 AI</span></span>' +
    '<span class="bo-chev">' + chevron + "</span></button>" +
    '<button class="backup-option" type="button" data-worlds-export="json">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.5H7.8a2 2 0 0 0-2 2v3.2c0 1-.7 1.8-1.6 1.8.9 0 1.6.8 1.6 1.8v3.2a2 2 0 0 0 2 2h1.7"/><path d="M14.5 4.5h1.7a2 2 0 0 1 2 2v3.2c0 1 .7 1.8 1.6 1.8-.9 0-1.6.8-1.6 1.8v3.2a2 2 0 0 1-2 2h-1.7"/></svg></span>' +
    '<span class="bo-main"><strong>JSON 文件（.json）</strong><span>结构化数据，可再导入回界书</span></span>' +
    '<span class="bo-chev">' + chevron + "</span></button>" +
    "</div>" +
    '<div class="sheet-actions"><button class="btn ghost" type="button" data-close-sheet>取消</button></div>' +
    "</div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-worlds-export]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.dataset.worldsExport;
      closeSheet();
      setTimeout(function () {
        if (kind === "docx") exportWorldsDocx();
        else exportWorldsJson();
      }, 240);
    });
  });
}

/* ---- 更多面板（加了「保存这组对话」） ---- */

function openChatMoreSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  var conv = chatById(activeChatId);
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-grab"></div>' +
    "<h3>更多</h3>" +
    '<div class="backup-options">' +
    '<button class="backup-option" type="button" data-chat-action="save"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8.4 10.4 12 14l3.6-3.6"/><path d="M5 17.5h14"/></svg></span><span class="bo-main"><strong>保存这组对话</strong><span>导出成 Word 或 JSON</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="image"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="5" width="16.8" height="14" rx="2.4"/><circle cx="9" cy="10.2" r="1.6"/><path d="M5.4 17.4 10 12.8l3 3 2.2-2.2 3.4 3.4"/></svg></span><span class="bo-main"><strong>发送图片</strong><span>让 AI 看看场景、人物或道具</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="file"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 3.6h7.2l4 4v12.8H6.4z"/><path d="M13.2 3.6v4.2h4.2"/><path d="M9.2 12.6h5.6M9.2 15.8h4"/></svg></span><span class="bo-main"><strong>发送文件</strong><span>把设定、文本交给 AI 读</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="settings"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/></svg></span><span class="bo-main"><strong>对话设置</strong><span>换对话模型、识图模型、最少字数</span></span></button>' +
    '<button class="backup-option" type="button" data-chat-action="clear"><span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.4 13.6l5.2-5.2 3.4 3.4-5.2 5.2z"/><path d="M9.4 15.4 6.6 18.2a1.7 1.7 0 0 1-2.4-2.4l2.8-2.8"/><path d="M15.6 6.4l2 2"/></svg></span><span class="bo-main"><strong>清空这段对话</strong><span>保留设定，只删掉聊天记录</span></span></button>' +
    "</div>" +
    '<div class="sheet-actions"><button class="btn ghost" type="button" data-close-sheet>取消</button></div>' +
    "</div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-chat-action]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var action = button.dataset.chatAction;
      closeSheet();
      if (action === "save") setTimeout(function () { openChatsExportSheet([conv], "保存这组对话"); }, 220);
      if (action === "image") setTimeout(function () { pickChatAttachment("image"); }, 220);
      if (action === "file") setTimeout(function () { pickChatAttachment("file"); }, 220);
      if (action === "settings") setTimeout(openChatSettings, 220);
      if (action === "clear") setTimeout(clearChatMessages, 220);
    });
  });
}

/* ---- 提示词：货币规则 + 严格扮演 ---- */

function chatSystemPrompt(conv) {
  var settings = chatSettings();
  var world = chatWorld(conv);
  var user = chatPersona(conv.userPersonaId);
  var npc = chatPersona(conv.npcPersonaId);
  var parts = [];
  parts.push(
    "你是「界书」里的叙事引擎，和一个用户一起把故事演下去。你只输出一个 JSON 对象，不要 Markdown 代码围栏、不要解释。"
  );
  parts.push(
    'JSON 结构：{"reply":"给用户看的正文","currency":"（可选）变化后的货币写法","stats":[{"label":"生命值","value":"85","reason":"被刀划伤"}]}'
  );
  parts.push(
    "只有在这一轮故事里数值或货币真的发生变化时，才写 stats / currency；没变化就省略这两个键。stats 的 label 必须与下面「状态栏」里已有的名字一致。"
  );
  if (world) parts.push(chatWorldBlock(world));
  if (user) {
    parts.push(
      "【用户扮演的角色】" + (user.name || "我") + "\n" + personaBrief(user).replace(/^\n+/, "")
    );
    parts.push("用户就是上面这个角色，不要替 TA 说话、不要替 TA 做决定、不要替 TA 行动。");
  }
  if (conv.mode === "persona" && npc) {
    parts.push(
      "【你扮演的角色】" + (npc.name || "TA") + "\n" + personaBrief(npc).replace(/^\n+/, "")
    );
    parts.push(
      "现在只有两个人：用户（" +
        (user && user.name ? user.name : "用户") +
        "）和你扮演的 " +
        (npc.name || "TA") +
        "。你只能演 " +
        (npc.name || "TA") +
        "，不能演其他人，也不能写用户的台词与动作。"
    );
    parts.push(
      "绝对不许出戏：不要提 AI、模型、提示词、设定文件，也不要说「作为一个角色」之类的话；语气、用词、知识范围都必须符合上面这份人设，人设不支持的技能与经历不能凭空拥有。"
    );
    parts.push(
      "格式约定：台词直接写；动作、神态、环境描写一律放在中文圆括号里，例如（他把门掩上，声音压得很低）。用户也会用（）写 TA 的动作，你要据此回应。"
    );
  } else {
    parts.push(
      "【你的身份】你是这个世界的 DM（叙事者兼所有 NPC）。用第二人称「你」描写用户所处的场景，让 NPC 各自说话做事，推动世界对用户的行动做出反应。"
    );
    parts.push("不要替用户做决定、不要写用户的心理活动，只写世界与 NPC 的回应。");
    parts.push("NPC 的动作、神态放在中文圆括号里，例如（她把灯芯挑亮）。");
  }
  var panel = [];
  var cfg = chatCurrencyConfig(conv);
  if (conv.panels && conv.panels.currency && (conv.currency || (world && world.currency) || cfg)) {
    var currencyLine = "货币：" + (conv.currency || (world && world.currency) || "—");
    var rule = chatCurrencyRule(conv);
    if (rule) currencyLine += "（" + rule + "）";
    panel.push(currencyLine);
    if (cfg) {
      var moneyLines = ["【货币设定】主货币叫「" + cfg.primary + "」，所有价格都用主货币计价。"];
      if (cfg.items.length) {
        moneyLines.push(
          "其它货币按「1 单位 = 折合多少主货币」换算：" +
            cfg.items
              .map(function (item) {
                return item.name + " 1 = " + chatCurrencyTrimNumber(item.rate) + " " + cfg.primary;
              })
              .join("；") +
            "。"
        );
      }
      moneyLines.push(
        "用户付出或收到其它货币时，先在心里换算成主货币，再把 currency 字段写成以主货币计的余额（例如「12 " +
          cfg.primary +
          "」）；currency 永远只写主货币。"
      );
      parts.push(moneyLines.join("\n"));
    }
  }
  var statList = conv.panels && conv.panels.stats ? conv.stats || [] : [];
  if (statList.length) {
    panel.push(
      "状态栏：" +
        statList
          .map(function (stat) {
            return stat.label + " " + stat.value;
          })
          .join("、")
    );
  }
  if (panel.length) {
    parts.push("【当前状态】\n" + panel.join("\n"));
    parts.push(
      "叙事时请把这些数值当成真实约束：受伤、消耗、获得都会让它们变化，变化时在 stats 里给出新的数值，并在 reply 里自然地体现出来。"
    );
  }
  if (statList.length) {
    var who = user && user.name ? user.name : "用户";
    parts.push(
      "【人物状态的约束】上面这些数值属于 " +
        who +
        "，它们会真实影响 TA 的处境，每一轮都要考虑：\n" +
        "· 生命值明显偏低（例如低于三成）时，要写伤口、呼吸急、站不稳、动作变慢，甚至濒临昏厥；\n" +
        "· 精神值明显偏低时，要写恍惚、听不真切、错觉、迟疑、情绪失控；\n" +
        "· 体力、饥饿、寒冷一类数值偏低时，写喘、手抖、走不动；\n" +
        "· 数值很高时也要体现：体力充沛、精神清明、行动利落；\n" +
        "· 身高、体重、年龄、寿命这类固定项不会因剧情改变，不要写进 stats；\n" +
        "· 只在剧情确实造成变化时才改数值，stats 里给出新值与 reason（例如「被刀划伤」），不要凭空涨落。"
    );
  }
  if (settings.minChars) {
    parts.push("reply 至少写 " + settings.minChars + " 个汉字，像小说一样有画面、有细节，不要一句话敷衍。");
  } else {
    parts.push("reply 写得有画面、有细节，像小说一样。");
  }
  return parts.join("\n\n");
}

/* ---- 状态面板：显示汇率 ---- */

function openChatPanel() {
  var conv = chatById(activeChatId);
  if (!conv) return;
  var root = $("#sheet-root");
  if (!root) return;
  var rows = [];
  if (conv.panels && conv.panels.currency) {
    var money = chatCurrencyConfig(conv);
    rows.push(
      '<div class="panel-row"><span class="panel-label">' +
        esc((money && money.primary) || conv.currencyLabel || "货币") +
        '</span><span class="panel-value">' +
        esc(conv.currency || "—") +
        "</span></div>"
    );
    if (money) {
      money.items.forEach(function (item) {
        rows.push(
          '<div class="panel-row is-sub"><span class="panel-label">1 ' +
            esc(item.name) +
            '</span><span class="panel-value">' +
            esc(chatCurrencyTrimNumber(item.rate) + " " + money.primary) +
            "</span></div>"
        );
      });
    }
  }
  if (conv.panels && conv.panels.stats) {
    (conv.stats || []).forEach(function (stat) {
      rows.push(
        '<div class="panel-row"><span class="panel-label">' +
          esc(stat.label) +
          '</span><span class="panel-value">' +
          esc(stat.value || "—") +
          "</span></div>"
      );
    });
  }
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="当前状态">' +
    '<div class="sheet-grab"></div>' +
    "<h3>当前状态</h3>" +
    '<p class="sheet-desc">AI 会根据剧情改这些值，你也可以手动改。</p>' +
    '<div class="panel-list">' +
    (rows.join("") || '<p class="chat-warn">这一组对话没有开状态栏。</p>') +
    "</div>" +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>关闭</button>' +
    '<button class="btn primary" type="button" id="panel-edit">修改数值</button>' +
    "</div></div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $("#panel-edit", root).addEventListener("click", function () {
    closeSheet();
    setTimeout(openChatPanelEdit, 220);
  });
}

/* ---- 新建对话：货币由用户自己定 ---- */

function guessCurrencyName(text) {
  var raw = String(text || "").trim();
  if (!raw) return "";
  var cut = raw.split(/[：:（(，,。]/)[0].trim();
  if (cut.length && cut.length <= 6) return cut;
  return "";
}

function openNewChatSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  if (!db.worlds.length && !db.personas.length) {
    alertDialog({
      title: "还没有材料",
      message: "先在世界观里写一个世界，或者在「人设」里建一个你自己，再回来开对话。",
      confirmText: "知道了"
    });
    return;
  }

  var worlds = db.worlds.slice();
  var users = db.personas.filter(function (p) {
    return p.type !== "npc";
  });
  var npcs = db.personas.filter(function (p) {
    return p.type === "npc";
  });
  var pick = {
    world: worlds.length ? worlds[0].id : "",
    user: users.length ? users[0].id : "",
    npc: npcs.length ? npcs[0].id : ""
  };
  var mode = "world";
  var chev =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 6.2 15.4 12l-5.8 5.8"/></svg>';

  function poolOf(kind) {
    return kind === "world" ? worlds : kind === "user" ? users : npcs;
  }

  function findIn(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function avatarOf(kind, item) {
    if (!item) return "?";
    if (kind === "world") return "界";
    return firstChar(item.name || "人", "人");
  }

  function nameOf(item) {
    return item ? item.name || "未命名" : "";
  }

  function metaOf(kind, item) {
    if (!item) return "";
    if (kind === "world") {
      var bits = [];
      if (item.region) bits.push(item.region);
      var npcCount = (item.npcs || []).length;
      bits.push(npcCount ? npcCount + " 位 NPC" : "尚无 NPC");
      var rules = (item.rules || []).length;
      if (rules) bits.push(rules + " 条规则");
      return bits.join(" · ");
    }
    var measure = personaMeasure(item);
    return measure || personaTypeLabel(item.type);
  }

  function pickerHtml(kind, label, list, emptyText) {
    if (!list.length) {
      return (
        '<div class="chat-field"><label class="field-label">' +
        label +
        '</label><p class="chat-warn">' +
        emptyText +
        "</p></div>"
      );
    }
    var items = list
      .map(function (item) {
        return (
          '<button class="chat-pick-item" type="button" data-pick-kind="' +
          kind +
          '" data-pick-value="' +
          esc(item.id) +
          '">' +
          '<span class="cp-avatar">' +
          esc(avatarOf(kind, item)) +
          "</span>" +
          '<span class="cp-main"><strong>' +
          esc(nameOf(item)) +
          "</strong><span>" +
          esc(metaOf(kind, item)) +
          "</span></span>" +
          '<span class="cp-check"></span>' +
          "</button>"
        );
      })
      .join("");
    return (
      '<div class="chat-field"><label class="field-label">' +
      label +
      "</label>" +
      '<div class="chat-picker">' +
      '<button class="chat-pick-btn" type="button" data-pick-open="' +
      kind +
      '" aria-expanded="false">' +
      '<span class="cp-avatar" data-cp-avatar="' +
      kind +
      '"></span>' +
      '<span class="cp-main"><strong data-cp-name="' +
      kind +
      '"></strong><span data-cp-meta="' +
      kind +
      '"></span></span>' +
      '<span class="cp-chev">' +
      chev +
      "</span>" +
      "</button>" +
      '<div class="chat-pick-list" data-pick-list="' +
      kind +
      '" hidden>' +
      items +
      "</div>" +
      "</div></div>"
    );
  }

  var curRows = [
    { name: "", rate: "" },
    { name: "", rate: "" }
  ];

  function curRowHtml(row, index) {
    return (
      '<div class="chat-cur-row">' +
      '<input class="text-input cur-name" type="text" maxlength="8" value="' +
      esc(row.name) +
      '" placeholder="' +
      (index === 0 ? "如：金币" : "如：银币") +
      '">' +
      '<input class="text-input cur-rate" type="text" maxlength="10" value="' +
      esc(row.rate) +
      '" placeholder="如 100">' +
      '<button class="stat-remove" type="button" data-cur-remove="' +
      index +
      '" aria-label="移除">×</button>' +
      "</div>"
    );
  }

  var draftStats = CHAT_DEFAULT_STATS.map(function (stat) {
    return { label: stat.label, value: stat.value };
  });

  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet chat-new-sheet" role="dialog" aria-modal="true" aria-label="新建对话">' +
    '<div class="sheet-grab"></div>' +
    "<h3>新建对话</h3>" +
    '<p class="sheet-desc">选一组角色，AI 会读取他们的设定，并把这个世界演下去。</p>' +
    '<div class="seg-row chat-mode-row">' +
    '<button class="seg is-active" type="button" data-chat-mode="world">世界观 × 用户人设</button>' +
    '<button class="seg" type="button" data-chat-mode="persona">用户人设 × NPC</button>' +
    "</div>" +
    '<div data-mode-block="world">' +
    pickerHtml("world", "世界观", worlds, "还没有世界观，先去建一个。") +
    "</div>" +
    pickerHtml("user", "你的角色（用户人设）", users, "还没有用户人设，先去人设页建一个。") +
    '<div class="hidden" data-mode-block="persona">' +
    pickerHtml("npc", "AI 扮演（NPC 人设）", npcs, "还没有 NPC 人设，先去建一个。") +
    "</div>" +
    '<label class="chat-toggle-row" for="chat-panel-currency">' +
    "<span><strong>显示货币</strong><small>下面自己定货币、分几级、汇率多少</small></span>" +
    '<input id="chat-panel-currency" class="bs-input" type="checkbox" checked>' +
    '<span class="bs-track" aria-hidden="true"><span class="bs-thumb"></span></span>' +
    "</label>" +
    '<div class="chat-currency-block" id="chat-currency-block">' +
    '<label class="field-label" for="chat-currency-name">主货币</label>' +
    '<input id="chat-currency-name" class="text-input" type="text" maxlength="10" placeholder="自己起名，例如：元 / 记忆 / 船票">' +
    '<div class="chat-cur-head"><span>其它货币</span><em>1 单位 = ? 主货币</em></div>' +
    '<div id="chat-currency-rows">' +
    curRows.map(curRowHtml).join("") +
    "</div>" +
    '<button class="mini-btn" type="button" id="chat-currency-add">+ 再加一种货币</button>' +
    '<p class="chat-hint" id="chat-currency-hint"></p>' +
    "</div>" +
    '<label class="chat-toggle-row" for="chat-panel-stats">' +
    "<span><strong>显示人物状态</strong><small>数值会随着剧情升降，也会影响 AI 的描写</small></span>" +
    '<input id="chat-panel-stats" class="bs-input" type="checkbox" checked>' +
    '<span class="bs-track" aria-hidden="true"><span class="bs-thumb"></span></span>' +
    "</label>" +
    '<div class="chat-stats-block" id="chat-stats-block">' +
    '<label class="field-label">状态栏（自己定要盯哪些值）</label>' +
    '<div id="chat-stat-rows">' +
    draftStats.map(statRowHtml).join("") +
    "</div>" +
    '<button class="mini-btn" type="button" id="chat-stat-add">+ 再加一项</button>' +
    "</div>" +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
    '<button class="btn primary" type="button" id="chat-create">开始对话</button>' +
    "</div></div>";

  requestAnimationFrame(function () {
    root.classList.add("open");
  });

  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });

  function syncPicker(kind) {
    var current = findIn(poolOf(kind), pick[kind]);
    var avatar = $('[data-cp-avatar="' + kind + '"]', root);
    if (avatar) avatar.textContent = avatarOf(kind, current);
    var nameEl = $('[data-cp-name="' + kind + '"]', root);
    if (nameEl) nameEl.textContent = current ? nameOf(current) : "还没有可选的";
    var metaEl = $('[data-cp-meta="' + kind + '"]', root);
    if (metaEl) metaEl.textContent = metaOf(kind, current);
    $$('[data-pick-list="' + kind + '"] .chat-pick-item', root).forEach(function (button) {
      button.classList.toggle("is-active", !!current && button.dataset.pickValue === current.id);
    });
  }

  function closeAllPicks() {
    $$("[data-pick-list]", root).forEach(function (listEl) {
      listEl.hidden = true;
    });
    $$("[data-pick-open]", root).forEach(function (button) {
      button.setAttribute("aria-expanded", "false");
      button.classList.remove("is-open");
    });
  }

  $$("[data-pick-open]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.dataset.pickOpen;
      var listEl = $('[data-pick-list="' + kind + '"]', root);
      var willOpen = listEl && listEl.hidden;
      closeAllPicks();
      if (listEl && willOpen) {
        listEl.hidden = false;
        button.setAttribute("aria-expanded", "true");
        button.classList.add("is-open");
      }
    });
  });

  $$("[data-pick-value]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.dataset.pickKind;
      pick[kind] = button.dataset.pickValue;
      syncPicker(kind);
      closeAllPicks();
      if (kind === "world") syncCurrencyBlock();
    });
  });

  $$("[data-chat-mode]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      mode = button.dataset.chatMode;
      $$("[data-chat-mode]", root).forEach(function (other) {
        other.classList.toggle("is-active", other === button);
      });
      $$("[data-mode-block]", root).forEach(function (block) {
        block.classList.toggle("hidden", block.dataset.modeBlock !== mode);
      });
      closeAllPicks();
      syncCurrencyBlock();
    });
  });

  function readCurrencyRows() {
    return $$(".chat-cur-row", $("#chat-currency-rows", root)).map(function (row) {
      return {
        name: ($(".cur-name", row) || {}).value || "",
        rate: ($(".cur-rate", row) || {}).value || ""
      };
    });
  }

  function currencyItems() {
    var primary = (($("#chat-currency-name", root) || {}).value || "").trim();
    var items = [];
    readCurrencyRows().forEach(function (row) {
      var name = String(row.name || "").trim();
      var rate = Number(String(row.rate || "").replace(/[^0-9.]/g, ""));
      if (!name || !isFinite(rate) || rate <= 0 || name === primary) return;
      items.push({ id: chatUid("cur"), name: name, rate: rate });
    });
    return { primary: primary, items: items };
  }

  function syncCurrencyBlock() {
    var on = $("#chat-panel-currency", root).checked;
    var block = $("#chat-currency-block", root);
    if (block) block.classList.toggle("hidden", !on);
    var statsOn = $("#chat-panel-stats", root).checked;
    var statsBlock = $("#chat-stats-block", root);
    if (statsBlock) statsBlock.classList.toggle("hidden", !statsOn);

    var nameInput = $("#chat-currency-name", root);
    var world = findIn(worlds, pick.world);
    if (nameInput && !nameInput.dataset.touched && world && world.currency) {
      nameInput.value = guessCurrencyName(world.currency);
    }
    var hint = $("#chat-currency-hint", root);
    if (hint) {
      var cfg = currencyItems();
      var parts = [];
      cfg.items.forEach(function (item) {
        parts.push("1 " + item.name + " = " + chatCurrencyTrimNumber(item.rate) + " " + (cfg.primary || "主币"));
      });
      hint.textContent = parts.length
        ? parts.join(" · ") + "；余额只按主货币记。"
        : "分几级都行：写名字 + 它值多少主货币。例如 金币 100、银币 10、铜币 0.1。";
    }
  }

  function rerenderCurRows(rows) {
    var host = $("#chat-currency-rows", root);
    if (!host) return;
    host.innerHTML = rows.map(curRowHtml).join("");
    bindCurRows();
    syncCurrencyBlock();
  }

  function bindCurRows() {
    $$(".chat-cur-row", root).forEach(function (row) {
      var nameField = $(".cur-name", row);
      if (nameField) {
        nameField.addEventListener("input", function () {
          var nameInput = $("#chat-currency-name", root);
          if (nameInput) nameInput.dataset.touched = nameInput.dataset.touched || "";
          syncCurrencyBlock();
        });
      }
      var rateField = $(".cur-rate", row);
      if (rateField) rateField.addEventListener("input", syncCurrencyBlock);
    });
    $$("[data-cur-remove]", root).forEach(function (button) {
      button.addEventListener("click", function () {
        var rows = readCurrencyRows();
        rows.splice(Number(button.dataset.curRemove), 1);
        if (!rows.length) rows.push({ name: "", rate: "" });
        rerenderCurRows(rows);
      });
    });
  }
  bindCurRows();

  $("#chat-currency-add", root).addEventListener("click", function () {
    var rows = readCurrencyRows();
    rows.push({ name: "", rate: "" });
    rerenderCurRows(rows);
    var inputs = $$(".cur-name", root);
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  var nameField = $("#chat-currency-name", root);
  if (nameField) {
    nameField.addEventListener("input", function () {
      nameField.dataset.touched = "1";
      syncCurrencyBlock();
    });
  }

  var currencyToggle = $("#chat-panel-currency", root);
  if (currencyToggle) currencyToggle.addEventListener("change", syncCurrencyBlock);
  var statsToggle = $("#chat-panel-stats", root);
  if (statsToggle) statsToggle.addEventListener("change", syncCurrencyBlock);

  var rowsHost = $("#chat-stat-rows", root);
  var collectRows = function () {
    return $$(".stat-edit-row", rowsHost).map(function (row) {
      return {
        label: $(".stat-label", row).value.trim(),
        value: $(".stat-value", row).value.trim()
      };
    });
  };
  var rerenderRows = function (stats) {
    rowsHost.innerHTML = stats.map(statRowHtml).join("");
    bindRowRemoves();
  };
  var bindRowRemoves = function () {
    $$("[data-stat-remove]", rowsHost).forEach(function (button) {
      button.addEventListener("click", function () {
        var rows = collectRows();
        rows.splice(Number(button.dataset.statRemove), 1);
        rerenderRows(rows);
      });
    });
  };
  bindRowRemoves();

  $("#chat-stat-add", root).addEventListener("click", function () {
    var rows = collectRows();
    rows.push({ label: "", value: "0" });
    rerenderRows(rows);
    var inputs = $$(".stat-label", rowsHost);
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  syncPicker("world");
  syncPicker("user");
  syncPicker("npc");
  syncCurrencyBlock();

  $("#chat-create", root).addEventListener("click", function () {
    var stats = collectRows().filter(function (item) {
      return item.label;
    });
    var money = currencyItems();
    var spec = {
      mode: mode,
      worldId: mode === "world" ? pick.world : "",
      userPersonaId: pick.user,
      npcPersonaId: mode === "persona" ? pick.npc : "",
      currency: $("#chat-panel-currency", root).checked,
      statsPanel: $("#chat-panel-stats", root).checked,
      stats: stats,
      currencyConfig: money.primary ? money : null
    };
    if (mode === "world" && !spec.worldId) {
      showToast("先选一个世界观");
      return;
    }
    if (!spec.userPersonaId) {
      showToast("先选你自己的角色");
      return;
    }
    if (mode === "persona" && !spec.npcPersonaId) {
      showToast("先选一个 NPC");
      return;
    }
    var world = findIn(worlds, spec.worldId);
    var currencyText = "";
    if (spec.currency) {
      if (spec.currencyConfig) currencyText = "0 " + spec.currencyConfig.primary;
      else if (world && world.currency) currencyText = world.currency;
    }
    var conv = {
      id: chatUid("chat"),
      title: "",
      mode: spec.mode,
      worldId: spec.worldId,
      userPersonaId: spec.userPersonaId,
      npcPersonaId: spec.npcPersonaId,
      currency: currencyText,
      currencyLabel: spec.currencyConfig ? spec.currencyConfig.primary : world ? "货币" : "共享物",
      currencyConfig: spec.currencyConfig,
      stats: spec.stats.map(function (item) {
        return { id: chatUid("s"), label: item.label, value: item.value };
      }),
      panels: { currency: spec.currency, stats: spec.statsPanel },
      groupId: "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.conversations.push(conv);
    persist(true);
    closeSheet();
    setTimeout(function () {
      openChat(conv.id);
    }, 220);
  });
}
/* ---- 键盘 ---- */

window.onKeyboardHeight = function (px) {
  var value = Math.max(0, Math.round(Number(px) || 0));
  document.documentElement.style.setProperty("--kb-height", value + "px");
  if (value > 0) {
    setTimeout(function () {
      if (typeof scrollChatToEnd === "function") scrollChatToEnd();
    }, 80);
  }
};

/* ---- 绑定 ---- */

function bindChatExtras() {
  var emptyNew = $("#chat-empty-new");
  if (emptyNew) emptyNew.addEventListener("click", openNewChatSheet);
  var saveAll = $("#save-chats");
  if (saveAll) {
    saveAll.addEventListener("click", function () {
      openChatsExportSheet(
        db.conversations.slice().sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        }),
        "保存全部对话"
      );
    });
  }
  var cancelSel = $("#chat-sel-cancel");
  if (cancelSel) cancelSel.addEventListener("click", endChatSelect);
  var groupSel = $("#chat-sel-group");
  if (groupSel) groupSel.addEventListener("click", groupSelectedChats);
  var delSel = $("#chat-sel-delete");
  if (delSel) delSel.addEventListener("click", deleteSelectedChats);
  renderChats();
}

bindChatExtras();

(function initChats() {
  var tab = $('[data-tab="chats"]');
  var add = $("#new-chat");
  if (add) add.addEventListener("click", openNewChatSheet);
  var back = $("#chat-back");
  if (back) back.addEventListener("click", closeChat);
  var send = $("#chat-send");
  if (send) send.addEventListener("click", sendChatMessage);
  var plus = $("#chat-plus");
  if (plus) plus.addEventListener("click", openChatMoreSheet);
  var panel = $("#chat-panel-btn");
  if (panel) panel.addEventListener("click", openChatPanel);
  var more = $("#chat-more");
  if (more) more.addEventListener("click", openChatMoreSheet);
  var input = $("#chat-input");
  if (input) {
    input.addEventListener("input", function () {
      autoGrow(input);
      if (chatEditingMessageId) return;
      var sendBtn = $("#chat-send");
      if (sendBtn) sendBtn.textContent = "发送";
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendChatMessage();
      }
    });
  }
  var fileInput = $("#chat-file");
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      var kind = fileInput.dataset.kind === "image" ? "image" : "file";
      readFileAsAttachment(file, kind).then(function (attachment) {
        if (!attachment) return;
        if (attachment.kind === "image" && !chatSettings().visionModel) {
          showToast("当前模型看不了图片，先到对话设置里选识图模型");
          return;
        }
        if (attachment.kind === "file" && !attachment.text) {
          showToast("这个文件不是纯文本，AI 读不了");
          return;
        }
        chatComposerAttachments.push(attachment);
        renderComposerAttachments();
      });
    });
  }
  initChatSettings();
})();

  /* ---------------- 对话框 ---------------- */

  function confirmDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var root = $("#modal-root");
      if (!root) {
        resolve(false);
        return;
      }
      root.innerHTML =
        '<div class="modal-backdrop" data-modal-cancel></div>' +
        '<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="8.5"/></svg></div>' +
        "<h3>" +
        esc(opts.title || "确认操作") +
        "</h3><p>" +
        esc(opts.message || "") +
        "</p>" +
        '<div class="modal-actions">' +
        '<button class="btn ghost" type="button" data-modal-cancel>' +
        esc(opts.cancelText || "取消") +
        "</button>" +
        '<button class="btn danger" type="button" data-modal-confirm>' +
        esc(opts.confirmText || "删除") +
        "</button></div></div></div>";

      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        root.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () {
          if (!root.classList.contains("open")) root.innerHTML = "";
        }, 240);
        resolve(value);
      };
      var onKey = function (event) {
        if (event.key === "Escape") finish(false);
      };

      $$("[data-modal-cancel]", root).forEach(function (el) {
        el.addEventListener("click", function () {
          finish(false);
        });
      });
      var modalWrap = $(".modal-wrap", root);
      if (modalWrap) {
        modalWrap.addEventListener("click", function (event) {
          if (event.target === modalWrap) finish(false);
        });
      }
      var confirm = $("[data-modal-confirm]", root);
      if (confirm) {
        confirm.addEventListener("click", function () {
          finish(true);
        });
      }
      document.addEventListener("keydown", onKey);
      requestAnimationFrame(function () {
        root.classList.add("open");
      });
      setTimeout(function () {
        var cancel = $("[data-modal-cancel]", root);
        if (cancel) cancel.focus();
      }, 80);
    });
  }

  function promptDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var root = $("#modal-root");
      if (!root) {
        resolve(null);
        return;
      }
      root.innerHTML =
        '<div class="modal-backdrop" data-modal-cancel></div>' +
        '<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-icon gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"/></svg></div>' +
        "<h3>" +
        esc(opts.title || "输入名称") +
        "</h3><p>" +
        esc(opts.message || "") +
        "</p>" +
        '<label class="prompt-field"><span>' +
        esc(opts.label || "名称") +
        '</span><input id="prompt-input" type="text" maxlength="' +
        (opts.maxlength || 30) +
        '" autocomplete="off" value="' +
        esc(opts.value || "") +
        '" placeholder="' +
        esc(opts.placeholder || "") +
        '"></label>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" type="button" data-modal-cancel>' +
        esc(opts.cancelText || "取消") +
        "</button>" +
        '<button class="btn primary" type="button" data-prompt-confirm>' +
        esc(opts.confirmText || "确定") +
        "</button></div></div></div>";

      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        root.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () {
          if (!root.classList.contains("open")) root.innerHTML = "";
        }, 240);
        resolve(value);
      };
      var confirmValue = function () {
        var input = $("#prompt-input");
        finish(input ? input.value.trim() : "");
      };
      var onKey = function (event) {
        if (event.key === "Escape") finish(null);
        if (event.key === "Enter") {
          event.preventDefault();
          confirmValue();
        }
      };
      $$("[data-modal-cancel]", root).forEach(function (el) {
        el.addEventListener("click", function () {
          finish(null);
        });
      });
      var wrap = $(".modal-wrap", root);
      if (wrap) {
        wrap.addEventListener("click", function (event) {
          if (event.target === wrap) finish(null);
        });
      }
      var confirm = $("[data-prompt-confirm]", root);
      if (confirm) confirm.addEventListener("click", confirmValue);
      document.addEventListener("keydown", onKey);
      requestAnimationFrame(function () {
        root.classList.add("open");
      });
      setTimeout(function () {
        var input = $("#prompt-input");
        if (input) {
          input.focus();
          try {
            input.setSelectionRange(input.value.length, input.value.length);
          } catch (err) {
            /* ignore */
          }
        }
      }, 100);
    });
  }

  function alertDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var root = $("#modal-root");
      if (!root) {
        resolve(false);
        return;
      }
      root.innerHTML =
        '<div class="modal-backdrop" data-modal-close></div>' +
        '<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-icon gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></svg></div>' +
        "<h3>" +
        esc(opts.title || "提示") +
        "</h3><p>" +
        esc(opts.message || "") +
        "</p>" +
        '<div class="modal-actions">' +
        '<button class="btn primary" type="button" data-modal-close>' +
        esc(opts.confirmText || "知道了") +
        "</button></div></div></div>";

      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        root.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () {
          if (!root.classList.contains("open")) root.innerHTML = "";
        }, 240);
        resolve(true);
      };
      var onKey = function (event) {
        if (event.key === "Escape" || event.key === "Enter") finish();
      };
      $$("[data-modal-close]", root).forEach(function (el) {
        el.addEventListener("click", finish);
      });
      var wrap = $(".modal-wrap", root);
      if (wrap) {
        wrap.addEventListener("click", function (event) {
          if (event.target === wrap) finish();
        });
      }
      document.addEventListener("keydown", onKey);
      requestAnimationFrame(function () {
        root.classList.add("open");
      });
      setTimeout(function () {
        var button = $("[data-modal-close]", root);
        if (button) button.focus();
      }, 100);
    });
  }

  function deleteWorld() {
    var world = currentWorld();
    if (!world) return;
    confirmDialog({
      title: "删除这个世界？",
      message:
        "「" +
        displayWorldName(world) +
        "」中的 " +
        world.npcs.length +
        " 位 NPC、" +
        world.rules.length +
        " 条规则都会一并删除，无法恢复。",
      confirmText: "确认删除"
    }).then(function (confirmed) {
      if (!confirmed) return;
      db.worlds = db.worlds.filter(function (item) {
        return item.id !== world.id;
      });
      pruneEmptyGroups();
      currentWorldId = null;
      openNpcIds.clear();
      selectionMode = false;
      selectedWorldIds.clear();
      persist(true);
      setTabUI("worlds");
      renderWorlds();
      showScreen("worlds");
      showToast("世界已删除");
    });
  }


  /* ============================================================
     AI 接入
     ============================================================ */

  function aiEndpoint(url) {
    var base = String(url || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    if (/\/chat\/completions$/i.test(base)) return base;
    if (/^https?:\/\/api\.deepseek\.com$/i.test(base)) {
      return base + "/chat/completions";
    }
    if (/\/v\d+$/i.test(base)) return base + "/chat/completions";
    return base + "/v1/chat/completions";
  }

  function truncateText(text, max) {
    var value = String(text || "");
    return value.length > max ? value.slice(0, max) + "…" : value;
  }

  function aiErrorMessage(status, body) {
    var detail = "";
    try {
      var parsed = JSON.parse(body);
      if (parsed && parsed.error) {
        detail = parsed.error.message || parsed.error.code || parsed.error.type || "";
      }
      if (!detail && parsed && parsed.message) detail = parsed.message;
    } catch (err) {
      detail = truncateText(body, 260);
    }
    if (status === 401 || status === 403) {
      return "API Key 无效，或当前 Key 没有调用该模型的权限。（HTTP " + status + "）";
    }
    if (status === 404) {
      return "接口地址或模型名称不正确，请检查 URL 与模型名。（HTTP 404）";
    }
    if (status === 429) {
      return "请求过于频繁或额度不足，请稍后再试。（HTTP 429）";
    }
    if (status >= 500) {
      return "模型服务暂时不可用，请稍后再试。（HTTP " + status + "）";
    }
    return (
      (detail ? detail : "AI 接口返回错误") +
      (status ? "（HTTP " + status + "）" : "")
    );
  }

  function extractAIContent(status, body) {
    if (status < 200 || status >= 300) {
      throw new Error(aiErrorMessage(status, body));
    }
    var data;
    try {
      data = JSON.parse(body);
    } catch (err) {
      throw new Error("接口返回的不是有效 JSON：" + truncateText(body, 160));
    }
    if (data.error) {
      throw new Error(data.error.message || "AI 接口返回错误");
    }
    var choice = data.choices && data.choices[0];
    var content = choice && choice.message ? choice.message.content : "";
    if (Array.isArray(content)) {
      content = content
        .map(function (part) {
          return typeof part === "string" ? part : part && part.text ? part.text : "";
        })
        .join("");
    }
    if (!content && choice && choice.message && choice.message.reasoning_content) {
      content = choice.message.reasoning_content;
    }
    if (!content && choice && choice.text) content = choice.text;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI 返回了空内容，请重试。");
    }
    return content.trim();
  }

  function makeAIError(message, status) {
    var error = new Error(message);
    error.status = Number(status) || 0;
    return error;
  }

  function handleAIResponse(id, status, body) {
    var request = aiRequests[id];
    if (!request) return;
    delete aiRequests[id];
    if (request.timer) clearTimeout(request.timer);
    if (status === 0) {
      request.reject(makeAIError(body || "无法连接 AI 接口", 0));
      return;
    }
    var numericStatus = Number(status);
    if (request.kind === "models") {
      if (numericStatus < 200 || numericStatus >= 300) {
        request.reject(makeAIError(aiErrorMessage(numericStatus, body || ""), numericStatus));
        return;
      }
      request.resolve({ status: numericStatus, body: body || "" });
      return;
    }
    if (request.kind === "chat" && activeAIRequestId === id) {
      activeAIRequestId = null;
    }
    try {
      if (numericStatus >= 200 && numericStatus < 300 && request.kind === "chat") {
        recordAIUsage(body || "", request);
      }
      request.resolve(extractAIContent(numericStatus, body || ""));
    } catch (err) {
      err.status = numericStatus;
      request.reject(err);
    }
  }

  function cancelAIRequest(id) {
    var request = aiRequests[id];
    if (!request) return false;
    delete aiRequests[id];
    if (request.timer) clearTimeout(request.timer);
    if (activeAIRequestId === id) activeAIRequestId = null;
    try {
      if (window.AndroidAI && typeof window.AndroidAI.cancel === "function") {
        window.AndroidAI.cancel(id);
      }
    } catch (err) {
      /* 原生取消失败时，前端忽略迟到结果即可 */
    }
    request.reject(makeAIError("AI_CANCELED", -1));
    return true;
  }

  window.onAIResponse = handleAIResponse;

  function aiChat(messages, options) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
      if (!isAIConfigured()) {
        reject(new Error("AI_NOT_CONFIGURED"));
        return;
      }
      var config = aiConfig();
      var endpoint = aiEndpoint(config.url);
      if (!/^https?:\/\//i.test(endpoint)) {
        reject(new Error("接口 URL 需以 http:// 或 https:// 开头"));
        return;
      }
      var body = JSON.stringify({
        model:
          (opts.model && String(opts.model).trim()) || config.model.trim(),
        messages: messages,
        temperature:
          typeof opts.temperature === "number" ? opts.temperature : 0.85,
        max_tokens: opts.maxTokens || 2600,
        stream: false
      });
      var id = "ai_" + Date.now().toString(36) + "_" + (aiRequestSeq += 1);
      activeAIRequestId = id;
      var timer = setTimeout(function () {
        if (!aiRequests[id]) return;
        delete aiRequests[id];
        if (activeAIRequestId === id) activeAIRequestId = null;
        reject(new Error("AI 请求超时，请检查网络或接口地址"));
      }, 100000);
      aiRequests[id] = {
        kind: "chat",
        model: (opts.model && String(opts.model).trim()) || config.model.trim(),
        tag: opts.tag || "AI",
        resolve: resolve,
        reject: reject,
        timer: timer
      };

      if (window.AndroidAI && typeof window.AndroidAI.request === "function") {
        try {
          window.AndroidAI.request(endpoint, config.key.trim(), body, id);
        } catch (err) {
          delete aiRequests[id];
          clearTimeout(timer);
          if (activeAIRequestId === id) activeAIRequestId = null;
          reject(err);
        }
        return;
      }

      if (typeof fetch !== "function") {
        delete aiRequests[id];
        clearTimeout(timer);
        if (activeAIRequestId === id) activeAIRequestId = null;
        reject(new Error("当前环境不支持网络请求"));
        return;
      }

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.key.trim()
        },
        body: body
      })
        .then(function (response) {
          return response.text().then(function (text) {
            window.onAIResponse(id, response.status, text);
          });
        })
        .catch(function (err) {
          window.onAIResponse(id, 0, String(err && err.message ? err.message : err));
        });
    });
  }

  function aiHttpGet(url, apiKey) {
    return new Promise(function (resolve, reject) {
      var id = "models_" + Date.now().toString(36) + "_" + (aiRequestSeq += 1);
      var timer = setTimeout(function () {
        if (!aiRequests[id]) return;
        delete aiRequests[id];
        reject(makeAIError("获取模型列表超时", 0));
      }, 35000);
      aiRequests[id] = {
        kind: "models",
        resolve: resolve,
        reject: reject,
        timer: timer
      };

      if (window.AndroidAI && typeof window.AndroidAI.get === "function") {
        try {
          window.AndroidAI.get(url, apiKey || "", id);
        } catch (err) {
          delete aiRequests[id];
          clearTimeout(timer);
          reject(err);
        }
        return;
      }

      if (typeof fetch !== "function") {
        delete aiRequests[id];
        clearTimeout(timer);
        reject(makeAIError("当前环境不支持网络请求", 0));
        return;
      }

      var headers = { Accept: "application/json" };
      if (apiKey) headers.Authorization = "Bearer " + apiKey;
      fetch(url, { method: "GET", headers: headers })
        .then(function (response) {
          return response.text().then(function (text) {
            window.onAIResponse(id, response.status, text);
          });
        })
        .catch(function (err) {
          window.onAIResponse(id, 0, String(err && err.message ? err.message : err));
        });
    });
  }

  var AI_SCHEMA =
    '{"name":"世界名称（20字内）","description":"世界概述（120-260字）","region":"地区分类（可多个，用顿号分隔）","currency":"货币制度（简洁说明）","npcs":[{"name":"NPC名字","age":"年龄字符串","gender":"男|女|双性|无性","persona":"人物设定（120-260字）"}],"rules":[{"title":"规则名称","content":"规则内容"}]}';

  function aiSystemPrompt() {
    return (
      "你是「界书」的世界观共创助手，擅长中文幻想、科幻、悬疑与群像设定。你只输出一个合法的 JSON 对象，不要输出 Markdown 代码围栏、解释、注释或任何前后缀。JSON 结构必须严格为：" +
      AI_SCHEMA +
      "。要求：gender 只能是 男、女、双性、无性 之一；age 用字符串；所有字段都必须出现，暂无内容时用空字符串或空数组；npcs 和 rules 各 2-4 条；文字有画面感，避免空泛套话。"
    );
  }

  function stringValue(value) {
    if (Array.isArray(value)) {
      return value
        .map(function (item) {
          return stringValue(item);
        })
        .filter(Boolean)
        .join("、");
    }
    if (value == null) return "";
    return String(value).trim();
  }

  function normalizeAIGender(gender) {
    var value = String(gender || "").trim();
    if (GENDERS.indexOf(value) >= 0) return value;
    var map = {
      男性: "男",
      男生: "男",
      male: "男",
      女性: "女",
      女生: "女",
      female: "女",
      双性: "双性",
      间性: "双性",
      无性: "无性",
      非二元: "双性",
      其他: "无性"
    };
    return map[value] || "男";
  }

  function normalizeAIWorld(payload, fallbackName) {
    var source =
      payload && payload.world && typeof payload.world === "object"
        ? payload.world
        : payload;
    if (!source || typeof source !== "object") {
      throw new Error("AI 返回格式无法识别");
    }
    var npcSource =
      source.npcs || source.characters || source.mainNpcs || source.main_npcs || [];
    var ruleSource =
      source.rules || source.baseRules || source.base_rules || source.foundation || [];
    var npcs = (Array.isArray(npcSource) ? npcSource : [])
      .slice(0, 8)
      .filter(function (npc) {
        return npc && typeof npc === "object";
      })
      .map(function (npc) {
        return {
          name: truncateText(stringValue(npc.name), 20),
          age: truncateText(stringValue(npc.age), 12),
          gender: normalizeAIGender(npc.gender),
          persona: truncateText(
            stringValue(npc.persona || npc.description || npc.setting),
            6000
          )
        };
      })
      .filter(function (npc) {
        return npc.name || npc.persona;
      });
    var rules = (Array.isArray(ruleSource) ? ruleSource : [])
      .slice(0, 8)
      .filter(function (rule) {
        return rule && typeof rule === "object";
      })
      .map(function (rule) {
        return {
          title: truncateText(stringValue(rule.title || rule.name), 40),
          content: truncateText(
            stringValue(rule.content || rule.description || rule.text),
            2000
          )
        };
      })
      .filter(function (rule) {
        return rule.title || rule.content;
      });
    return {
      name: truncateText(
        stringValue(source.name || source.title) || fallbackName || "",
        24
      ),
      description: truncateText(
        stringValue(source.description || source.overview || source.summary),
        600
      ),
      region: truncateText(
        stringValue(source.region || source.regions || source.regionCategory),
        60
      ),
      currency: truncateText(
        stringValue(source.currency || source.currencySystem || source.economy),
        80
      ),
      npcs: npcs,
      rules: rules
    };
  }

  function extractJSONObject(text) {
    var value = String(text || "").trim();
    value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    var start = value.indexOf("{");
    var end = value.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("AI 没有返回可用的 JSON，请重试");
    }
    var body = value.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch (err) {
      try {
        return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
      } catch (err2) {
        throw new Error("AI 返回的 JSON 格式无法解析，请重试");
      }
    }
  }

  function parseAIWorld(text, fallbackName) {
    return normalizeAIWorld(extractJSONObject(text), fallbackName);
  }

  function worldForAI(world) {
    return {
      name: world.name || "",
      description: world.description || "",
      region: world.region || "",
      currency: world.currency || "",
      npcs: (world.npcs || []).map(function (npc) {
        return {
          name: npc.name || "",
          age: npc.age || "",
          gender: npc.gender || "男",
          persona: npc.persona || ""
        };
      }),
      rules: (world.rules || []).map(function (rule) {
        return { title: rule.title || "", content: rule.content || "" };
      })
    };
  }

  function friendlyAIError(error) {
    var message = String(error && error.message ? error.message : error || "");
    if (message === "AI_NOT_CONFIGURED") return "还没有配置 AI 模型，请先在设置中接入模型。";
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
      return "无法连接 AI 接口。请检查网络、URL 与 API Key 是否正确。";
    }
    if (/timeout|超时/i.test(message)) {
      return "AI 响应超时了，请稍后再试，或换一个更快的模型。";
    }
    if (/JSON|格式|解析/i.test(message)) {
      return message + "。可以再试一次，或换一个模型。";
    }
    return truncateText(message || "AI 暂时没有回应", 360);
  }

  function setAIActionsDisabled(disabled) {
    $$("[data-ai-action]").forEach(function (button) {
      button.disabled = disabled;
      button.classList.toggle("disabled", disabled);
    });
    $$("[data-persona-ai]").forEach(function (button) {
      button.disabled = disabled;
      button.classList.toggle("disabled", disabled);
    });
    var personaGenerate = $("#persona-ai-generate");
    if (personaGenerate) personaGenerate.disabled = disabled;
    var testButton = $("#test-ai");
    if (testButton) testButton.disabled = disabled;
  }

  function showAILoading(title, subtitle) {
    var overlay = $("#ai-loading");
    if (!overlay) return;
    aiBackgroundWait = false;
    hideAITaskPill();
    $("#ai-loading-title").textContent = title || "AI 正在编织世界";
    $("#ai-loading-sub").textContent =
      subtitle || "请稍候，它在整理星尘与叙事。";
    var cancelButton = $("#ai-cancel");
    var backgroundButton = $("#ai-background");
    if (cancelButton) cancelButton.disabled = false;
    if (backgroundButton) backgroundButton.disabled = false;
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
    try {
      if (window.AndroidAI && typeof window.AndroidAI.requestNotifyPermission === "function") {
        window.AndroidAI.requestNotifyPermission();
      }
    } catch (err) {
      /* 通知权限只影响后台通知，不影响生成 */
    }
  }

  function hideAILoading() {
    var overlay = $("#ai-loading");
    if (!overlay) return;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
  }

  function showAITaskPill() {
    var pill = $("#ai-task-pill");
    if (!pill) return;
    var title = pill.querySelector(".ai-task-copy strong");
    var note = pill.querySelector(".ai-task-copy small");
    if (title) title.textContent = aiTaskInfo.label || "AI 正在后台生成";
    if (note) note.textContent = "完成后会通知你";
    pill.classList.add("visible");
    pill.setAttribute("aria-hidden", "false");
  }

  function hideAITaskPill() {
    var pill = $("#ai-task-pill");
    if (!pill) return;
    pill.classList.remove("visible");
    pill.setAttribute("aria-hidden", "true");
  }

  function notifyAIDone(title, body) {
    var safeTitle = title || "界书 · AI 已完成";
    var safeBody = body || "AI 生成已完成，结果已更新。";
    try {
      if (window.AndroidAI && typeof window.AndroidAI.notifyDone === "function") {
        window.AndroidAI.notifyDone(safeTitle, safeBody);
        return;
      }
    } catch (err) {
      /* 通知失败时仍有应用内提示 */
    }
    try {
      if (typeof Notification === "function" && Notification.permission === "granted") {
        new Notification(safeTitle, { body: safeBody });
      }
    } catch (err) {
      /* 浏览器可能不支持通知 */
    }
  }

  function finishAITaskUI(success, body) {
    var wasBackground = aiBackgroundWait;
    /* 页面在后台（切到桌面或别的应用）时同样需要通知用户 */
    var shouldNotify = wasBackground || !!document.hidden;
    hideAILoading();
    hideAITaskPill();
    aiBusy = false;
    aiBackgroundWait = false;
    activeAIRequestId = null;
    setAIActionsDisabled(false);
    if (shouldNotify) {
      if (success) {
        notifyAIDone(
          aiTaskInfo.doneTitle || "界书 · AI 已完成",
          body || aiTaskInfo.doneBody || "AI 生成已完成，结果已更新。"
        );
        showToast("AI 已完成，结果已更新");
      } else {
        notifyAIDone("界书 · AI 未完成", body || "AI 生成没有完成，请回到界书查看。");
      }
    }
    return wasBackground;
  }

  function sendAIToBackground() {
    if (!aiBusy) return;
    aiBackgroundWait = true;
    hideAILoading();
    showAITaskPill();
  }

  function cancelAIGeneration() {
    var id = activeAIRequestId;
    if (id) cancelAIRequest(id);
    aiBackgroundWait = false;
    hideAILoading();
    hideAITaskPill();
    aiBusy = false;
    activeAIRequestId = null;
    setAIActionsDisabled(false);
    showToast("已取消 AI 生成");
  }

  function isAICancelError(error) {
    return !!(error && error.message === "AI_CANCELED");
  }

  function applyAIResult(world, result, mode) {
    var addedNpcs = 0;
    var addedRules = 0;

    if (result.name && !world.name.trim()) world.name = result.name;

    if (result.description) {
      if (!world.description.trim() || mode === "optimize" || mode === "expand") {
        world.description = result.description;
      }
    }
    if (result.region) {
      if (!world.region.trim() || mode === "optimize" || mode === "expand") {
        world.region = result.region;
      }
    }
    if (result.currency) {
      if (!world.currency.trim() || mode === "optimize" || mode === "expand") {
        world.currency = result.currency;
      }
    }

    result.npcs.forEach(function (aiNpc) {
      if (!aiNpc.name && !aiNpc.persona) return;
      var existing = null;
      for (var i = 0; i < world.npcs.length; i += 1) {
        if (
          world.npcs[i].name &&
          aiNpc.name &&
          world.npcs[i].name.trim() === aiNpc.name.trim()
        ) {
          existing = world.npcs[i];
          break;
        }
      }
      if (existing) {
        if (mode === "optimize") {
          if (aiNpc.age) existing.age = aiNpc.age;
          if (aiNpc.gender) existing.gender = aiNpc.gender;
          if (aiNpc.persona) existing.persona = aiNpc.persona;
        } else if (mode === "expand") {
          if (!existing.age && aiNpc.age) existing.age = aiNpc.age;
          if (!existing.gender && aiNpc.gender) existing.gender = aiNpc.gender;
          if (!existing.persona.trim()) {
            existing.persona = aiNpc.persona;
          } else if (
            aiNpc.persona &&
            existing.persona.indexOf(aiNpc.persona.slice(0, 14)) < 0
          ) {
            existing.persona = truncateText(
              existing.persona + "\n\n" + aiNpc.persona,
              6000
            );
          }
        } else {
          if (!existing.age && aiNpc.age) existing.age = aiNpc.age;
          if (!existing.gender && aiNpc.gender) existing.gender = aiNpc.gender;
          if (!existing.persona.trim() && aiNpc.persona) {
            existing.persona = aiNpc.persona;
          }
        }
      } else {
        world.npcs.push({
          id: uid("n"),
          name: aiNpc.name,
          age: aiNpc.age,
          gender: aiNpc.gender,
          persona: aiNpc.persona
        });
        addedNpcs += 1;
      }
    });

    result.rules.forEach(function (aiRule) {
      if (!aiRule.title && !aiRule.content) return;
      var existing = null;
      for (var i = 0; i < world.rules.length; i += 1) {
        if (
          world.rules[i].title &&
          aiRule.title &&
          world.rules[i].title.trim() === aiRule.title.trim()
        ) {
          existing = world.rules[i];
          break;
        }
      }
      if (existing) {
        if (mode === "optimize") {
          if (aiRule.content) existing.content = aiRule.content;
        } else if (mode === "expand") {
          if (
            aiRule.content &&
            existing.content.indexOf(aiRule.content.slice(0, 14)) < 0
          ) {
            existing.content = truncateText(
              existing.content + "\n" + aiRule.content,
              2000
            );
          }
        } else if (!existing.content) {
          existing.content = aiRule.content;
        }
      } else {
        world.rules.push({
          id: uid("r"),
          title: aiRule.title,
          content: aiRule.content
        });
        addedRules += 1;
      }
    });

    touch(world);
    persist(true);

    if (currentWorldId === world.id) {
      $("#world-name").value = world.name || "";
      $("#world-desc").value = world.description || "";
      $("#world-region").value = world.region || "";
      $("#world-currency").value = world.currency || "";
      renderNpcList();
      renderRules();
      updateEditorCounts();
      autoGrow($("#world-desc"));
    }

    var summary = [];
    if (addedNpcs) summary.push(addedNpcs + " 位新 NPC");
    if (addedRules) summary.push(addedRules + " 条新规则");
    showToast(
      "AI 已" +
        (mode === "fill" ? "补全" : mode === "optimize" ? "优化" : "扩展") +
        "这个世界" +
        (summary.length ? "，新增 " + summary.join("、") : "")
    );
  }

  function runAIAction(mode) {
    var world = currentWorld();
    if (!world || aiBusy) return;
    if (!isAIConfigured()) {
      showToast("请先接入 AI 模型");
      openSettings("editor");
      return;
    }

    var instructions = {
      fill:
        "请在不覆盖已有内容的前提下，补全这个世界所有空缺的信息。已有字段保持原样；如果缺少 NPC 或规则，请补齐；最终返回完整 JSON。",
      optimize:
        "请在保留既有事实、角色和规则的前提下，优化这个世界的文字：让概述更有画面感与结构感，完善地区与货币，润色 NPC 人设与规则；不要删除已有角色或规则；最终返回完整 JSON。",
      expand:
        "请在不推翻既有设定的前提下扩展这个世界：丰富概述、地区分类与货币制度，新增 2-3 位与现有设定有张力的 NPC，并新增 1-2 条底层规则；保留原有内容；最终返回完整 JSON。"
    };
    var labels = {
      fill: ["正在补全世界", "AI 正在寻找缺失的拼图。"],
      optimize: ["正在优化文字", "AI 正在打磨语气与结构。"],
      expand: ["正在扩展世界", "AI 正在让边界生长。"],
      fuse: ["正在融合世界", "AI 正在寻找两个世界的共同母题。"]
    };

    var modeNames = { fill: "AI 填写", optimize: "AI 优化", expand: "AI 扩展" };
    aiBusy = true;
    aiTaskInfo = {
      label: labels[mode][0],
      doneTitle: "界书 · AI 已完成"
    };
    setAIActionsDisabled(true);
    showAILoading(labels[mode][0], labels[mode][1]);

    aiChat(
      [
        { role: "system", content: aiSystemPrompt() },
        {
          role: "user",
          content:
            instructions[mode] +
            "\n\n当前世界观：\n" +
            JSON.stringify(worldForAI(world), null, 2)
        }
      ],
      { temperature: mode === "optimize" ? 0.55 : 0.82, maxTokens: 2800 }
    )
      .then(function (text) {
        var result = parseAIWorld(text, world.name || "未命名世界");
        applyAIResult(world, result, mode);
        finishAITaskUI(
          true,
          "「" +
            displayWorldName(world) +
            "」的 " +
            modeNames[mode] +
            "已完成，结果已写回世界。"
        );
      })
      .catch(function (error) {
        if (isAICancelError(error)) {
          finishAITaskUI(false);
          return;
        }
        finishAITaskUI(
          false,
          "「" + displayWorldName(world) + "」的 AI 写作没有完成。"
        );
        alertDialog({
          title: "AI 没有完成这次写作",
          message: friendlyAIError(error),
          confirmText: "知道了"
        });
      });
  }

  /* ============================================================
     接入模型设置
     ============================================================ */

  function detectAIProvider(url, model) {
    var normalized = String(url || "").trim();
    if (/api\.deepseek\.com/i.test(normalized)) return "deepseek";
    if (/dashscope[^/]*\.aliyuncs\.com/i.test(normalized)) return "qwen";
    return "custom";
  }

  function modelListCandidates(baseUrl) {
    var base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) return [];
    if (/\/chat\/completions$/i.test(base)) {
      base = base.replace(/\/chat\/completions$/i, "");
    }
    var urls = [];
    var seen = {};
    var add = function (url) {
      if (!url || seen[url]) return;
      if (!/^https?:\/\//i.test(url)) return;
      seen[url] = true;
      urls.push(url);
    };
    var rootMatch = base.match(/^(https?:\/\/[^\/]+)/i);
    var root = rootMatch ? rootMatch[1] : "";

    if (/api\.deepseek\.com/i.test(base)) {
      add("https://api.deepseek.com/models");
    }
    if (/dashscope[^/]*\.aliyuncs\.com/i.test(base)) {
      add(base + "/models");
      add("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    }
    if (/\/v\d+$/i.test(base)) {
      add(base + "/models");
    } else if (root) {
      add(root + "/v1/models");
      add(base + "/models");
    } else {
      add(base + "/models");
    }
    if (root) add(root + "/models");
    return urls;
  }

  function isChatModel(item, provider, id) {
    var modelId = String(id || "").toLowerCase();
    var name = String((item && item.name) || "").toLowerCase();
    if (!modelId) return false;
    if (provider === "deepseek") {
      return /flash|pro|chat|reasoner/.test(modelId);
    }
    if (provider === "qwen") {
      var caps = item && Array.isArray(item.capabilities) ? item.capabilities : null;
      if (caps && caps.length) {
        return caps.indexOf("TG") >= 0 || caps.indexOf("Reasoning") >= 0;
      }
    }
    var combined = modelId + " " + name;
    if (/(embedding|rerank|tts|asr|speech|audio|image|video|wan|omni|realtime|3d|moderation)/.test(combined)) {
      if (!/deepseek-(flash|v4-pro)/.test(modelId)) return false;
    }
    return true;
  }

  function parseModelCatalog(body, provider) {
    var payload;
    try {
      payload = JSON.parse(body);
    } catch (err) {
      throw makeAIError("模型列表不是有效 JSON", 0);
    }
    var items = Array.isArray(payload)
      ? payload
      : payload.data ||
        payload.models ||
        (payload.output && payload.output.models) ||
        payload.result ||
        [];
    if (!Array.isArray(items)) return [];
    var mapped = [];
    var seen = {};
    var order = 0;
    items.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var id = stringValue(item.id || item.model || item.model_id);
      if (!id || seen[id]) return;
      seen[id] = true;
      var name = stringValue(item.name || item.display_name || item.displayName);
      var created = Number(item.created) || 0;
      if (!created && item.published_time) {
        created = Date.parse(String(item.published_time).replace(" ", "T")) || 0;
      }
      if (created > 0 && created < 100000000000) created *= 1000;
      if (!isChatModel(item, provider, id)) return;
      mapped.push({
        id: id,
        name: name || resolveModelName(id, [], provider),
        version: stringValue(item.version || item.model_version || ""),
        latest: false,
        created: created,
        order: order
      });
      order += 1;
    });

    var hasCreated = mapped.some(function (model) {
      return model.created > 0;
    });
    mapped.sort(function (a, b) {
      if (hasCreated && a.created !== b.created) return b.created - a.created;
      var av = modelVersionScore(a);
      var bv = modelVersionScore(b);
      if (av !== bv) return bv - av;
      return a.order - b.order;
    });
    mapped = mapped.slice(0, 10);
    if (mapped.length) mapped[0].latest = true;
    return mapped;
  }

  function setModelDetectStatus(text, type) {
    var el = $("#model-detect-status");
    if (!el) return;
    el.textContent = text || "";
    el.className = "model-detect-status" + (type ? " " + type : "");
  }

  function updateModelNameDisplay() {
    var el = $("#ai-model-name");
    if (!el) return;
    var ai = aiConfig();
    if (!ai.model) {
      el.textContent = "尚未选择模型";
      return;
    }
    var name = ai.modelName || resolveModelName(ai.model, ai.models, ai.provider);
    el.innerHTML =
      "当前：<strong>" +
      esc(name) +
      '</strong> <span class="model-id">' +
      esc(ai.model) +
      "</span>" +
      (isDeprecatedModel(ai.model)
        ? ' <span class="model-deprecated">该模型已下线</span>'
        : "");
  }

  function findModelInCatalog(id, models, provider) {
    var pools = [];
    if (Array.isArray(models)) pools = pools.concat(models);
    pools = pools.concat(builtinModels(provider));
    for (var i = 0; i < pools.length; i += 1) {
      if (pools[i].id === id) return pools[i];
    }
    return null;
  }

  function renderModelPicks() {
    var container = $("#model-picks");
    if (!container) return;
    var ai = aiConfig();
    var models = ai.models && ai.models.length
      ? ai.models
      : builtinModels(ai.provider);
    if (!models.length) {
      container.innerHTML =
        '<div class="model-picks-empty">填写 API Key 后可自动识别可用模型</div>';
      return;
    }
    container.innerHTML = models
      .slice(0, 6)
      .map(function (model) {
        var active = model.id === ai.model;
        return (
          '<button class="model-pick' +
          (active ? " active" : "") +
          '" type="button" data-model-id="' +
          esc(model.id) +
          '">' +
          '<span class="model-pick-main">' +
          '<span class="model-pick-name">' +
          esc(model.name || formatModelName(model.id)) +
          "</span>" +
          '<span class="model-pick-id">' +
          esc(model.id) +
          "</span>" +
          "</span>" +
          (model.latest ? '<span class="latest-badge">最新</span>' : "") +
          "</button>"
        );
      })
      .join("");
  }

  function applyModelCatalog(models, source, options) {
    var opts = options || {};
    var ai = aiConfig();
    if (!Array.isArray(models) || !models.length) return false;
    ai.models = models.slice(0, 10);
    ai.detectedAt = Date.now();
    var latest = ai.models[0];
    var current = findModelInCatalog(ai.model, ai.models, ai.provider);
    var shouldUseLatest =
      opts.forceLatest ||
      !ai.manualModel ||
      !ai.model ||
      !current ||
      isDeprecatedModel(ai.model);
    if (shouldUseLatest) {
      ai.model = latest.id;
      ai.modelName = latest.name || formatModelName(latest.id);
      ai.manualModel = false;
    } else {
      ai.modelName = current.name || resolveModelName(ai.model, ai.models, ai.provider);
    }
    persist(false);
    var input = $("#ai-model");
    if (input) input.value = ai.model;
    updateModelNameDisplay();
    renderModelPicks();
    updateSettingsStatus();
    return true;
  }

  function selectModelById(id) {
    var ai = aiConfig();
    var model = findModelInCatalog(id, ai.models, ai.provider);
    if (!model) return;
    ai.model = model.id;
    ai.modelName = model.name || formatModelName(model.id);
    ai.manualModel = true;
    var input = $("#ai-model");
    if (input) input.value = ai.model;
    persist(true);
    updateModelNameDisplay();
    renderModelPicks();
    updateSettingsStatus();
    setModelDetectStatus("已选择 " + ai.modelName, "ok");
  }

  function discoverModels(options) {
    var opts = options || {};
    if (modelDiscoveryBusy) return Promise.resolve(false);
    var ai = aiConfig();
    if (!ai.url.trim() || !ai.key.trim()) {
      if (opts.manual) {
        setModelDetectStatus("先填写接口 URL 和 API Key，再自动识别模型。", "err");
      }
      return Promise.resolve(false);
    }
    modelDiscoveryBusy = true;
    var button = $("#auto-model");
    if (button) {
      button.disabled = true;
      button.textContent = "识别中…";
    }
    setModelDetectStatus("正在识别可用模型…", "testing");
    var provider = detectAIProvider(ai.url, ai.model);
    var candidates = modelListCandidates(ai.url);
    var index = 0;
    var lastError = null;

    return new Promise(function (resolve) {
      var finish = function (ok) {
        modelDiscoveryBusy = false;
        if (button) {
          button.disabled = false;
          button.textContent = "自动识别最新";
        }
        resolve(ok);
      };
      var useFallback = function (reason) {
        var cached = ai.models && ai.models.length ? ai.models : builtinModels(provider);
        if (!cached.length) {
          setModelDetectStatus(
            reason + (lastError ? "：" + friendlyAIError(lastError) : ""),
            "err"
          );
          finish(false);
          return;
        }
        if (!ai.models || !ai.models.length || opts.forceLatest) {
          applyModelCatalog(cached, "builtin", { forceLatest: opts.forceLatest });
        } else {
          updateModelNameDisplay();
          renderModelPicks();
        }
        var latest = cached[0];
        setModelDetectStatus(
          reason + " · 当前 " + (ai.modelName || latest.name || ai.model),
          ""
        );
        finish(false);
      };
      var tryNext = function () {
        if (index >= candidates.length) {
          useFallback("接口暂未返回模型列表，已使用内置最新目录");
          return;
        }
        var endpoint = candidates[index];
        index += 1;
        aiHttpGet(endpoint, ai.key)
          .then(function (response) {
            var models = parseModelCatalog(response.body || "", provider);
            if (!models.length) {
              lastError = makeAIError("模型列表中没有可用的对话模型", 0);
              tryNext();
              return;
            }
            applyModelCatalog(models, "api", { forceLatest: opts.forceLatest });
            var latest = models[0];
            setModelDetectStatus(
              "已同步 " +
                models.length +
                " 个模型 · 最新：" +
                (latest.name || latest.id),
              "ok"
            );
            finish(true);
          })
          .catch(function (error) {
            lastError = error;
            if (error.status === 401 || error.status === 403) {
              setModelDetectStatus(friendlyAIError(error), "err");
              finish(false);
              return;
            }
            tryNext();
          });
      };
      tryNext();
    });
  }

  function setKeyConfigOpen(open) {
    var box = $("#key-config");
    var toggle = $("#key-config-toggle");
    if (!box) return;
    box.classList.toggle("open", !!open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function updateKeyConfigStatus() {
    var status = $("#key-config-status");
    if (!status) return;
    var hasKey = !!(aiConfig().key && aiConfig().key.trim());
    status.textContent = hasKey ? "已配置" : "未配置";
    status.classList.toggle("configured", hasKey);
  }

  function applyCustomBackground() {
    var layer = $("#custom-bg");
    if (!layer) return;
    var bg = db.settings && db.settings.background;
    if (bg && bg.dataUrl) {
      layer.style.backgroundImage = 'url("' + bg.dataUrl + '")';
      layer.classList.add("active");
    } else {
      layer.style.backgroundImage = "none";
      layer.classList.remove("active");
    }
  }

  function updateBackgroundUI() {
    var preview = $("#bg-preview");
    var status = $("#bg-status");
    var remove = $("#remove-bg");
    if (!preview) return;
    var bg = db.settings && db.settings.background;
    var hasImage = !!(bg && bg.dataUrl);
    preview.classList.toggle("has-image", hasImage);
    preview.style.backgroundImage = hasImage ? 'url("' + bg.dataUrl + '")' : "";
    preview.innerHTML =
      "<span>" +
      esc(hasImage ? bg.name || "自定义背景" : "默认深空背景") +
      "</span>";
    if (remove) remove.disabled = !hasImage;
    if (status) {
      status.className = "bg-status";
      status.textContent = hasImage
        ? "已启用自定义背景 · " + (bg.name || "图片")
        : "当前使用默认深空背景";
    }
  }

  function handleBackgroundFile(file) {
    var input = $("#bg-file");
    var status = $("#bg-status");
    if (!file) return;
    if (!/^image\//i.test(file.type || "")) {
      if (status) {
        status.className = "bg-status err";
        status.textContent = "请选择 JPG、PNG 或 WebP 图片。";
      }
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      if (status) {
        status.className = "bg-status err";
        status.textContent = "图片超过 25 MB，请换一张小一些的图片。";
      }
      return;
    }
    if (status) {
      status.className = "bg-status";
      status.textContent = "正在压缩并保存图片…";
    }
    var choose = $("#choose-bg");
    if (choose) choose.disabled = true;
    var reader = new FileReader();
    reader.onload = function () {
      var image = new Image();
      image.onload = function () {
        try {
          var max = 1440;
          var width = image.naturalWidth || image.width;
          var height = image.naturalHeight || image.height;
          var scale = Math.min(1, max / Math.max(width, height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#08070d";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          db.settings.background = {
            dataUrl: dataUrl,
            name: file.name || "自定义背景"
          };
          persist(true);
          applyCustomBackground();
          updateBackgroundUI();
          if (status) {
            status.className = "bg-status ok";
            status.textContent = "背景已更新并保存。";
          }
          showToast("背景已更新");
        } catch (error) {
          if (status) {
            status.className = "bg-status err";
            status.textContent = "图片处理失败，请换一张试试。";
          }
        } finally {
          if (choose) choose.disabled = false;
          if (input) input.value = "";
        }
      };
      image.onerror = function () {
        if (status) {
          status.className = "bg-status err";
          status.textContent = "无法读取这张图片，请换一张。";
        }
        if (choose) choose.disabled = false;
        if (input) input.value = "";
      };
      image.src = reader.result;
    };
    reader.onerror = function () {
      if (status) {
        status.className = "bg-status err";
        status.textContent = "读取图片失败，请重试。";
      }
      if (choose) choose.disabled = false;
      if (input) input.value = "";
    };
    reader.readAsDataURL(file);
  }

  function removeBackground() {
    if (!db.settings.background || !db.settings.background.dataUrl) return;
    db.settings.background = { dataUrl: "", name: "" };
    persist(true);
    applyCustomBackground();
    updateBackgroundUI();
    showToast("已恢复默认背景");
  }

  function syncSettingsForm() {
    var ai = aiConfig();
    var url = $("#ai-url");
    var key = $("#ai-key");
    var model = $("#ai-model");
    if (url) url.value = ai.url || "";
    if (key) {
      key.value = ai.key || "";
      key.type = "password";
    }
    if (model) model.value = ai.model || "";
    var toggle = $("#toggle-key");
    if (toggle) toggle.textContent = "显示";
    var result = $("#ai-test-result");
    if (result) {
      result.textContent = "";
      result.className = "ai-test-result";
    }
    updateModelNameDisplay();
    renderModelPicks();
    updateSettingsStatus();
    if (ai.models && ai.models.length) {
      setModelDetectStatus(
        ai.detectedAt
          ? "已缓存 " + ai.models.length + " 个模型，可重新同步"
          : "内置最新目录 · 填写 Key 后可同步接口模型",
        ""
      );
    } else {
      setModelDetectStatus("填写 URL 与 API Key 后可自动识别模型", "");
    }
    updateKeyConfigStatus();
    setKeyConfigOpen(!ai.key);
  }

  function updateSettingsStatus() {
    var ai = aiConfig();
    var ready = isAIConfigured();
    var state = $("#settings-ai-state");
    if (state) {
      state.classList.toggle("ready", ready);
      state.textContent = ready
        ? "已配置 · " + (ai.modelName || ai.model)
        : "未连接";
    }
    var badge = $("#ai-config-state");
    if (badge) badge.textContent = ready ? "已配置" : "未配置";
    var provider = detectAIProvider(ai.url, ai.model);
    $$("[data-ai-preset]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.aiPreset === provider);
    });
    updateKeyConfigStatus();
    updateAIReadyBadge();
  }

  function readSettingsForm() {
    var ai = db.settings.ai;
    var urlInput = $("#ai-url");
    var keyInput = $("#ai-key");
    var modelInput = $("#ai-model");
    var previousProvider = ai.provider;
    ai.url = urlInput ? urlInput.value.trim() : ai.url;
    ai.key = keyInput ? keyInput.value.trim() : ai.key;
    ai.model = modelInput ? modelInput.value.trim() : ai.model;
    ai.provider = detectAIProvider(ai.url, ai.model);
    if (ai.provider !== previousProvider) {
      ai.models = builtinModels(ai.provider).slice();
      ai.detectedAt = 0;
      ai.manualModel = false;
      if (ai.models.length) {
        ai.model = ai.models[0].id;
        ai.modelName = ai.models[0].name;
        if (modelInput) modelInput.value = ai.model;
      }
    }
    ai.modelName = resolveModelName(ai.model, ai.models, ai.provider);
    persist(false);
    updateModelNameDisplay();
    renderModelPicks();
    updateSettingsStatus();
    updateKeyConfigStatus();
    return ai;
  }

  function saveAISettings(announce) {
    var ai = readSettingsForm();
    persist(true);
    updateSettingsStatus();
    if (ai.key && ai.key.trim()) setKeyConfigOpen(false);
    if (announce) {
      if (isAIConfigured()) {
        showToast("AI 配置已保存");
      } else {
        showToast("已保存，但还缺少 URL、API Key 或模型名");
      }
    }
    return ai;
  }

  function applyAIPreset(provider) {
    var preset = AI_PRESETS[provider];
    if (!preset) return;
    var ai = db.settings.ai;
    ai.provider = provider;
    ai.url = preset.url;
    ai.model = preset.model;
    ai.modelName = preset.modelName;
    ai.models = builtinModels(provider).slice();
    ai.detectedAt = 0;
    ai.manualModel = false;
    var urlInput = $("#ai-url");
    var modelInput = $("#ai-model");
    if (urlInput) urlInput.value = preset.url;
    if (modelInput) modelInput.value = preset.model;
    persist(true);
    updateModelNameDisplay();
    renderModelPicks();
    updateSettingsStatus();
    setModelDetectStatus(
      "已填入 " + preset.label + " · " + preset.modelName,
      "ok"
    );
    showToast("已选择 " + preset.label + " · " + preset.modelName);
    if (!db.settings.ai.key) setKeyConfigOpen(true);
    if (isAIConfigured()) {
      setTimeout(function () {
        discoverModels({ forceLatest: true, silent: true });
      }, 250);
    }
  }

  function openSettings(returnTo) {
    settingsReturn =
      returnTo || (currentWorldId ? "editor" : "worlds");
    syncSettingsForm();
    showScreen("settings");
    var bar = $("#selection-bar");
    if (bar) bar.classList.remove("visible");
    var scroller = $(".settings-scroll");
    if (scroller) scroller.scrollTop = 0;
    updateBackgroundUI();
    if (isAIConfigured()) {
      setTimeout(function () {
        discoverModels({ silent: true });
      }, 350);
    }
  }

  function closeSettings() {
    saveAISettings(false);
    var target = settingsReturn;
    if (target === "editor" && currentWorldId) {
      showScreen("editor");
      updateAIReadyBadge();
    } else if (target === "persona-edit" && personaDraft) {
      showScreen("persona-edit");
      updateAIReadyBadge();
      abilityChips();
    } else if (target === "chat" || target === "chat-settings") {
      updateAIReadyBadge();
      if (target === "chat-settings") {
        renderChatSettings();
        showScreen("chat-settings");
      } else if (activeChatId) {
        renderChat();
        showScreen("chat");
      } else {
        renderChats();
        showScreen("chats");
      }
      setTabUI("chats");
    } else {
      setTabUI("worlds");
      showScreen("worlds");
      renderWorlds();
    }
    settingsReturn = "worlds";
  }

  function setTestResult(text, type) {
    var el = $("#ai-test-result");
    if (!el) return;
    el.textContent = text;
    el.className = "ai-test-result" + (type ? " " + type : "");
  }

  function testAIConnection() {
    var ai = saveAISettings(false);
    if (!isAIConfigured()) {
      setTestResult("请先填写接口 URL、API Key 和模型名称。", "err");
      setKeyConfigOpen(true);
      var keyInput = $("#ai-key");
      if (keyInput) keyInput.focus();
      return;
    }
    var button = $("#test-ai");
    if (button) {
      button.disabled = true;
      button.textContent = "连接中…";
    }
    setTestResult(
      "正在连接 " + (ai.modelName || ai.model) + "…",
      "testing"
    );
    aiChat(
      [{ role: "user", content: "只回复：连接成功" }],
      { temperature: 0.1, maxTokens: 20 }
    )
      .then(function () {
        setTestResult(
          "连接成功 · " + (ai.modelName || ai.model) + "（" + ai.model + "）",
          "ok"
        );
        showToast("AI 连接成功");
      })
      .catch(function (error) {
        setTestResult(friendlyAIError(error), "err");
      })
      .then(function () {
        if (button) {
          button.disabled = false;
          button.textContent = "测试连接";
        }
      });
  }

  /* ============================================================
     一句话生成
     ============================================================ */

  function openAIGenerateSheet() {
    if (!isAIConfigured()) {
      showToast("请先接入 AI 模型");
      openSettings("worlds");
      return;
    }
    var root = $("#sheet-root");
    if (!root) return;
    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet ai-sheet" role="dialog" aria-modal="true" aria-label="一句话生成世界观">' +
      '<div class="sheet-grab"></div>' +
      '<span class="eyebrow">ONE SENTENCE, ONE WORLD</span>' +
      "<h3>一句话生成世界观</h3>" +
      '<p class="sheet-desc">写下一个念头，AI 会把它生长成完整的世界。</p>' +
      '<textarea id="ai-world-prompt" class="ai-prompt-input" maxlength="500" placeholder="例如：一座会吞食梦境的海边城市，居民用梦换取潮汐的宽恕……"></textarea>' +
      '<div class="ai-examples">' +
      '<button class="example-chip" type="button">一座建立在鲸鱼背上的移动城市</button>' +
      '<button class="example-chip" type="button">记忆可以被酿成酒，醉后能看见未来</button>' +
      '<button class="example-chip" type="button">永夜降临后，人们靠种植星星照明</button>' +
      "</div>" +
      '<div class="ai-sheet-actions">' +
      '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
      '<button id="generate-world" class="btn primary" type="button">生成世界</button>' +
      "</div>" +
      '<p class="ai-sheet-tip">生成后会打开编辑界面，所有内容都可以继续修改。</p>' +
      "</div>";
    requestAnimationFrame(function () {
      root.classList.add("open");
    });
    $$("[data-close-sheet]", root).forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });
    $$(".example-chip", root).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var input = $("#ai-world-prompt");
        if (!input) return;
        input.value = chip.textContent;
        input.focus();
      });
    });
    var generate = $("#generate-world");
    if (generate) generate.addEventListener("click", generateWorldFromPrompt);
    setTimeout(function () {
      var input = $("#ai-world-prompt");
      if (input) input.focus();
    }, 380);
  }

  function generateWorldFromPrompt() {
    var input = $("#ai-world-prompt");
    var prompt = input ? input.value.trim() : "";
    if (!prompt) {
      showToast("先写下一句话");
      if (input) input.focus();
      return;
    }
    if (aiBusy) return;
    closeSheet();
    aiBusy = true;
    aiTaskInfo = {
      label: "正在生长一个世界",
      doneTitle: "界书 · 新世界已生成"
    };
    showAILoading("正在生长一个世界", "从一句话里，长出地理、角色与规则。");
    aiChat(
      [
        { role: "system", content: aiSystemPrompt() },
        {
          role: "user",
          content:
            "请根据下面这句话，生长出一个完整、可继续创作的世界观。要有清晰的核心冲突、可探索的地区与自洽的底层规则。\n一句话概念：" +
            prompt
        }
      ],
      { temperature: 0.9, maxTokens: 3000 }
    )
      .then(function (text) {
        var result = parseAIWorld(text, prompt.slice(0, 24));
        var world = {
          id: uid("w"),
          name: result.name || prompt.slice(0, 20),
          description: result.description,
          region: result.region,
          currency: result.currency,
          groupId: null,
          sourcePrompt: prompt,
          fusedFrom: [],
          npcs: result.npcs.map(function (npc) {
            return {
              id: uid("n"),
              name: npc.name,
              age: npc.age,
              gender: npc.gender,
              persona: npc.persona
            };
          }),
          rules: result.rules.map(function (rule) {
            return {
              id: uid("r"),
              title: rule.title,
              content: rule.content
            };
          }),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        db.worlds.push(world);
        persist(true);
        renderWorlds();
        openEditor(world.id, false);
        showToast("世界已生成，继续把它写完吧");
        finishAITaskUI(
          true,
          "新世界「" + displayWorldName(world) + "」已生成，可以继续编辑。"
        );
      })
      .catch(function (error) {
        if (isAICancelError(error)) {
          finishAITaskUI(false);
          return;
        }
        finishAITaskUI(false, "这次没有生成出新世界。");
        alertDialog({
          title: "这次没有生成成功",
          message: friendlyAIError(error),
          confirmText: "知道了"
        });
      });
  }

  /* ============================================================
     多选、分组与融合
     ============================================================ */

  function selectedWorlds() {
    var worlds = [];
    selectedWorldIds.forEach(function (id) {
      var world = findWorld(id);
      if (world) worlds.push(world);
    });
    return worlds;
  }

  function pruneEmptyGroups() {
    db.groups = db.groups.filter(function (group) {
      return db.worlds.some(function (world) {
        return world.groupId === group.id;
      });
    });
  }

  function deleteSelectedWorlds() {
    var worlds = selectedWorlds();
    if (!worlds.length) {
      showToast("还没有选择世界");
      return;
    }
    confirmDialog({
      title: "删除选中的世界？",
      message:
        "将删除 " +
        worlds.length +
        " 个世界及其中的 NPC、规则。此操作无法恢复。",
      confirmText: "确认删除"
    }).then(function (confirmed) {
      if (!confirmed) return;
      var ids = worlds.map(function (world) {
        return world.id;
      });
      db.worlds = db.worlds.filter(function (world) {
        return ids.indexOf(world.id) < 0;
      });
      pruneEmptyGroups();
      currentWorldId = null;
      persist(true);
      exitSelection();
      showToast("已删除 " + worlds.length + " 个世界");
    });
  }

  function groupSelectedWorlds() {
    var worlds = selectedWorlds();
    if (!worlds.length) {
      showToast("还没有选择世界");
      return;
    }
    promptDialog({
      title: "归位一组",
      message:
        "为选中的 " +
        worlds.length +
        " 个世界建一个组。之后每个组都可以单独改名。",
      label: "组名",
      placeholder: "例如：雾海群岛合集",
      confirmText: "归位"
    }).then(function (name) {
      if (name === null) return;
      var group = {
        id: uid("g"),
        name: name || "未命名组",
        collapsed: false,
        createdAt: Date.now()
      };
      db.groups.push(group);
      worlds.forEach(function (world) {
        world.groupId = group.id;
        touch(world);
      });
      pruneEmptyGroups();
      persist(true);
      exitSelection();
      showToast("已归位到「" + group.name + "」");
    });
  }

  function toggleGroup(groupId) {
    var group = findGroup(groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    persist(false);
    renderWorlds();
  }

  function renameGroup(groupId) {
    var group = findGroup(groupId);
    if (!group) return;
    promptDialog({
      title: "给这个组改名",
      message: "组名只影响主界面的归类方式，不会修改世界内容。",
      label: "组名",
      value: group.name,
      placeholder: "组名",
      confirmText: "保存"
    }).then(function (name) {
      if (name === null) return;
      group.name = name || "未命名组";
      persist(true);
      renderWorlds();
      showToast("组名已更新");
    });
  }

  function fuseSelectedWorlds() {
    var worlds = selectedWorlds();
    if (worlds.length < 2) {
      showToast("至少选择两个世界才能融合");
      return;
    }
    if (worlds.length > 6) {
      alertDialog({
        title: "一次最多融合 6 个世界",
        message: "先减少一些选择，再让 AI 融合。",
        confirmText: "知道了"
      });
      return;
    }
    if (!isAIConfigured()) {
      showToast("请先接入 AI 模型");
      openSettings("worlds");
      return;
    }
    if (aiBusy) return;
    var ids = worlds.map(function (world) {
      return world.id;
    });
    aiBusy = true;
    aiTaskInfo = {
      label: "正在融合 " + worlds.length + " 个世界",
      doneTitle: "界书 · AI 融合完成"
    };
    showAILoading(
      "正在融合 " + worlds.length + " 个世界",
      "AI 正在提取共同母题，并保留每个世界最独特的意象。"
    );
    aiChat(
      [
        { role: "system", content: aiSystemPrompt() },
        {
          role: "user",
          content:
            "请融合下面这些世界观。不要简单拼接，也不要直接复用原标题；请提炼它们共同的母题，保留各自最有辨识度的地理、制度、冲突与角色意象，生成一个全新的世界。原世界不会被删除。\n\n世界列表：\n" +
            JSON.stringify(
              worlds.map(function (world) {
                return worldForAI(world);
              }),
              null,
              2
            )
        }
      ],
      { temperature: 0.88, maxTokens: 3200 }
    )
      .then(function (text) {
        var result = parseAIWorld(text, "未命名融合世界");
        var fused = {
          id: uid("w"),
          name: result.name || "未命名融合世界",
          description: result.description,
          region: result.region,
          currency: result.currency,
          groupId: null,
          sourcePrompt: "AI 融合",
          fusedFrom: ids,
          npcs: result.npcs.map(function (npc) {
            return {
              id: uid("n"),
              name: npc.name,
              age: npc.age,
              gender: npc.gender,
              persona: npc.persona
            };
          }),
          rules: result.rules.map(function (rule) {
            return {
              id: uid("r"),
              title: rule.title,
              content: rule.content
            };
          }),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        db.worlds.push(fused);
        persist(true);
        exitSelection();
        renderWorlds();
        openEditor(fused.id, false);
        showToast("融合完成，原世界都还在");
        finishAITaskUI(
          true,
          "融合世界「" + displayWorldName(fused) + "」已生成，原世界都还在。"
        );
      })
      .catch(function (error) {
        if (isAICancelError(error)) {
          finishAITaskUI(false);
          return;
        }
        finishAITaskUI(false, "这次融合没有完成。");
        alertDialog({
          title: "这次融合没有完成",
          message: friendlyAIError(error),
          confirmText: "知道了"
        });
      });
  }

  /* ============================================================
     启动动画
     ============================================================ */

  function dismissIntro() {
    var intro = $("#intro");
    if (!intro || intro.classList.contains("done")) return;
    intro.classList.add("done");
    setTimeout(function () {
      if (intro.parentNode) intro.parentNode.removeChild(intro);
    }, 360);
  }

  /* 入场动画总时长 3 秒（与提示音时长对齐） */
  setTimeout(dismissIntro, 3000);
  (function () {
    var intro = $("#intro");
    if (intro) intro.addEventListener("pointerdown", dismissIntro);
  })();


  /* ---------------- 事件绑定 ---------------- */

  $("#add-world").addEventListener("click", addWorld);
  $("#open-settings").addEventListener("click", function () {
    openSettings("worlds");
  });
  $("#settings-back").addEventListener("click", closeSettings);
  $("#ai-world-banner").addEventListener("click", openAIGenerateSheet);

  $$("[data-ai-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      runAIAction(button.dataset.aiAction);
    });
  });

  $("#ai-cancel").addEventListener("click", cancelAIGeneration);
  $("#ai-background").addEventListener("click", sendAIToBackground);
  $("#ai-task-cancel").addEventListener("click", cancelAIGeneration);

  $$("[data-ai-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      applyAIPreset(button.dataset.aiPreset);
    });
  });

  ["ai-url", "ai-key"].forEach(function (id) {
    var input = $("#" + id);
    if (!input) return;
    input.addEventListener("input", function () {
      readSettingsForm();
    });
  });

  $("#ai-model").addEventListener("input", function () {
    var ai = aiConfig();
    ai.manualModel = true;
    readSettingsForm();
  });

  $("#ai-key").addEventListener("blur", function () {
    if (isAIConfigured() && !modelDiscoveryBusy) {
      discoverModels({ silent: true });
    }
  });

  $("#auto-model").addEventListener("click", function () {
    discoverModels({ manual: true, forceLatest: true });
  });

  $("#model-picks").addEventListener("click", function (event) {
    var pick = event.target.closest("[data-model-id]");
    if (!pick) return;
    selectModelById(pick.dataset.modelId);
  });

  $("#key-config-toggle").addEventListener("click", function () {
    var box = $("#key-config");
    var open = box && box.classList.contains("open");
    setKeyConfigOpen(!open);
  });

  $("#choose-bg").addEventListener("click", function () {
    var input = $("#bg-file");
    if (input) input.click();
  });

  $("#bg-file").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    handleBackgroundFile(file);
  });

  $("#remove-bg").addEventListener("click", removeBackground);

  $("#toggle-key").addEventListener("click", function () {
    var input = $("#ai-key");
    var button = $("#toggle-key");
    if (!input) return;
    var showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "显示" : "隐藏";
  });

  $("#save-ai").addEventListener("click", function () {
    saveAISettings(true);
  });
  $("#test-ai").addEventListener("click", testAIConnection);

  $("#cancel-selection").addEventListener("click", exitSelection);
  $("#selection-delete").addEventListener("click", deleteSelectedWorlds);
  $("#selection-group").addEventListener("click", groupSelectedWorlds);
  $("#selection-fuse").addEventListener("click", fuseSelectedWorlds);

  function clearPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressStart = null;
  }

  $("#world-list").addEventListener("pointerdown", function (event) {
    var card = event.target.closest(".world-card");
    if (!card || selectionMode) return;
    if (event.button != null && event.button !== 0) return;
    pressStart = {
      x: event.clientX,
      y: event.clientY,
      id: card.dataset.worldId
    };
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      pressTimer = null;
      if (!pressStart) return;
      var worldId = pressStart.id;
      pressStart = null;
      enterSelection(worldId);
    }, 520);
  });

  $("#world-list").addEventListener("pointermove", function (event) {
    if (!pressStart) return;
    var dx = Math.abs(event.clientX - pressStart.x);
    var dy = Math.abs(event.clientY - pressStart.y);
    if (dx > 9 || dy > 9) clearPress();
  });

  $("#world-list").addEventListener("pointerup", clearPress);
  $("#world-list").addEventListener("pointercancel", clearPress);
  $("#view-worlds").addEventListener("scroll", clearPress, { passive: true });
  $("#world-list").addEventListener("contextmenu", function (event) {
    if (event.target.closest(".world-card")) event.preventDefault();
  });

  $("#world-list").addEventListener("click", function (event) {
    var emptyButton = event.target.closest("#empty-create");
    if (emptyButton) {
      addWorld();
      return;
    }
    var groupToggle = event.target.closest('[data-action="toggle-group"]');
    if (groupToggle) {
      toggleGroup(groupToggle.dataset.groupId);
      return;
    }
    var rename = event.target.closest('[data-action="rename-group"]');
    if (rename) {
      renameGroup(rename.dataset.groupId);
      return;
    }
    var card = event.target.closest(".world-card");
    if (!card || !card.dataset.worldId) return;
    if (
      suppressClickWorldId &&
      card.dataset.worldId === suppressClickWorldId &&
      Date.now() < suppressClickUntil
    ) {
      suppressClickWorldId = null;
      event.preventDefault();
      return;
    }
    if (selectionMode) {
      toggleSelection(card.dataset.worldId);
      return;
    }
    openEditor(card.dataset.worldId, false);
  });

  $$(".tab").forEach(function (button) {
    button.addEventListener("click", function () {
      if (selectionMode) exitSelection();
      var tab = button.dataset.tab;
      setTabUI(tab);
      var target =
        tab === "chats" ? "chats" : tab === "personas" ? "personas" : "worlds";
      showScreen(target);
      var screen = $("#view-" + target);
      if (screen) {
        screen.scrollTop = 0;
        var stuckBar = screen.querySelector(".topbar");
        if (stuckBar) stuckBar.classList.remove("is-stuck");
      }
      if (tab === "worlds") renderWorlds();
      if (tab === "personas") renderPersonas();
      if (tab === "chats") renderChats();
    });
  });

  $$(".screen").forEach(function (screen) {
    if (!screen.querySelector(".topbar")) return;
    screen.addEventListener(
      "scroll",
      function () {
        var bar = screen.querySelector(".topbar");
        if (bar) bar.classList.toggle("is-stuck", screen.scrollTop > 6);
      },
      { passive: true }
    );
  });

  $("#editor-back").addEventListener("click", closeEditor);

  $("#world-name").addEventListener("input", function (event) {
    var world = currentWorld();
    if (!world) return;
    world.name = event.target.value;
    touch(world);
    persist(false);
  });

  $("#world-name").addEventListener("blur", function (event) {
    var world = currentWorld();
    if (!world) return;
    var trimmed = event.target.value.trim();
    if (trimmed !== event.target.value) {
      event.target.value = trimmed;
      world.name = trimmed;
      touch(world);
      persist(false);
    }
  });

  $("#world-name").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      var desc = $("#world-desc");
      if (desc) desc.focus();
    }
  });

  $("#world-desc").addEventListener("input", function (event) {
    var world = currentWorld();
    if (!world) return;
    world.description = event.target.value;
    touch(world);
    autoGrow(event.target);
    persist(false);
  });

  $("#world-region").addEventListener("input", function (event) {
    var world = currentWorld();
    if (!world) return;
    world.region = event.target.value;
    touch(world);
    persist(false);
  });

  $("#world-currency").addEventListener("input", function (event) {
    var world = currentWorld();
    if (!world) return;
    world.currency = event.target.value;
    touch(world);
    persist(false);
  });

  $("#add-npc").addEventListener("click", addNpc);
  $("#add-rule").addEventListener("click", addRule);
  $("#pick-persona").addEventListener("click", openPersonaPicker);
  $("#delete-world").addEventListener("click", deleteWorld);

  $("#npc-list").addEventListener("click", function (event) {
    var deleteButton = event.target.closest('[data-action="delete-npc"]');
    if (deleteButton) {
      var deleteCard = deleteButton.closest(".npc-card");
      if (deleteCard) deleteNpc(deleteCard);
      return;
    }
    var genderButton = event.target.closest('[data-action="gender"]');
    if (genderButton) {
      selectNpcGender(genderButton);
      return;
    }
    var toggle = event.target.closest('[data-action="toggle-npc"]');
    if (toggle) {
      var card = toggle.closest(".npc-card");
      if (card) toggleNpc(card);
    }
  });

  $("#npc-list").addEventListener("input", function (event) {
    if (event.target.dataset.field) handleNpcInput(event.target);
  });

  $("#rule-list").addEventListener("input", function (event) {
    if (event.target.dataset.ruleField) handleRuleInput(event.target);
  });

  $("#rule-list").addEventListener("click", function (event) {
    var deleteButton = event.target.closest('[data-action="delete-rule"]');
    if (deleteButton) deleteRule(deleteButton);
  });

  document.addEventListener("focusin", function (event) {
    var target = event.target;
    if (!target || !/^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
    setTimeout(function () {
      if (document.activeElement === target && target.isConnected) {
        if ($("#view-editor").classList.contains("active")) {
          ensureEditorVisible(target);
        } else {
          try {
            target.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch (err) {
            target.scrollIntoView(false);
          }
        }
      }
    }, 280);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      flushSave();
      if (aiBusy && !aiBackgroundWait) sendAIToBackground();
    }
  });
  window.addEventListener("pagehide", flushSave);

  /* ---------------- 返回键 ---------------- */

  window.appBack = function () {
    var intro = $("#intro");
    if (intro && !intro.classList.contains("done")) {
      dismissIntro();
      return true;
    }

    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) {
      active.blur();
      return true;
    }

    var loading = $("#ai-loading");
    if (loading && loading.classList.contains("visible")) {
      return true;
    }

    var sheet = $("#sheet-root");
    if (sheet && sheet.classList.contains("open")) {
      closeSheet();
      return true;
    }

    var modal = $("#modal-root");
    if (modal && modal.classList.contains("open")) {
      var cancel = $("[data-modal-cancel]", modal) || $("[data-modal-close]", modal);
      if (cancel) cancel.click();
      return true;
    }

    if ($("#view-guide").classList.contains("active")) {
      closeGuide();
      return true;
    }

    if ($("#view-persona-edit").classList.contains("active")) {
      closePersonaEditor();
      return true;
    }

    if ($("#view-chat-settings").classList.contains("active")) {
      closeChatSettings();
      return true;
    }

    if ($("#view-chat").classList.contains("active")) {
      closeChat();
      return true;
    }

    if ($("#view-settings").classList.contains("active")) {
      closeSettings();
      return true;
    }

    if (selectionMode) {
      exitSelection();
      return true;
    }

    if ($("#view-editor").classList.contains("active")) {
      closeEditor();
      return true;
    }

    if (activeTab === "chats") {
      setTabUI("worlds");
      showScreen("worlds");
      renderWorlds();
      return true;
    }

    if (activeTab === "personas") {
      setTabUI("worlds");
      showScreen("worlds");
      renderWorlds();
      return true;
    }

    return false;
  };

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      var handled = window.appBack();
      if (!handled) return;
    }
  });

  /* ---------------- 初始化 ---------------- */

  applyCustomBackground();
  updateBackgroundUI();
  renderWorlds();
  initPersonas();
  setTabUI("worlds");
  showScreen("worlds");
  updateSettingsStatus();
/* ============================================================
   AI 导入：把 docx / txt / pdf 里的设定读成世界观或人设
   ============================================================ */

var importKind = "world";
var importBusy = false;

function importLatin1(bytes) {
  var out = "";
  var step = 8192;
  for (var i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + step, bytes.length))
    );
  }
  return out;
}

function importInflate(bytes, format) {
  if (typeof DecompressionStream === "undefined" || typeof Response === "undefined") {
    return Promise.resolve(null);
  }
  try {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Response(stream)
      .arrayBuffer()
      .then(function (buffer) {
        return new Uint8Array(buffer);
      })
      .catch(function () {
        return null;
      });
  } catch (error) {
    return Promise.resolve(null);
  }
}

function importEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (all, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#([0-9]+);/g, function (all, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    })
    .replace(/&amp;/g, "&");
}

function importDecodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch (e) {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function importDocxXmlText(xml) {
  var text = String(xml)
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]*>/g, "");
  return importEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function importDocxText(buffer) {
  var bytes = new Uint8Array(buffer);
  var view = new DataView(buffer);
  var eocd = -1;
  var floor = Math.max(0, bytes.length - 66000);
  for (var i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return Promise.reject(new Error("这不是一个有效的 Word 文档"));
  var count = view.getUint16(eocd + 10, true);
  var offset = view.getUint32(eocd + 16, true);
  var target = null;
  for (var k = 0; k < count && offset + 46 <= bytes.length; k++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    var method = view.getUint16(offset + 10, true);
    var compSize = view.getUint32(offset + 20, true);
    var nameLen = view.getUint16(offset + 28, true);
    var extraLen = view.getUint16(offset + 30, true);
    var commentLen = view.getUint16(offset + 32, true);
    var localOffset = view.getUint32(offset + 42, true);
    var name = importLatin1(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
    if (name !== "word/document.xml") continue;
    var localNameLen = view.getUint16(localOffset + 26, true);
    var localExtraLen = view.getUint16(localOffset + 28, true);
    var start = localOffset + 30 + localNameLen + localExtraLen;
    target = { method: method, data: bytes.subarray(start, start + compSize) };
    break;
  }
  if (!target) return Promise.reject(new Error("这个 Word 文档里没有找到正文"));
  var body =
    target.method === 0
      ? Promise.resolve(target.data)
      : importInflate(target.data, "deflate-raw");
  return body.then(function (raw) {
    if (!raw || !raw.length) throw new Error("这个 Word 文档读不出来");
    return importDocxXmlText(new TextDecoder("utf-8").decode(raw));
  });
}

/* ---------- PDF：尽力读出文字 ---------- */

function importPdfHexToText(hex) {
  var clean = String(hex).replace(/[^0-9a-fA-F]/g, "");
  var out = "";
  if (clean.length % 4 === 0) {
    for (var i = 0; i < clean.length; i += 4) {
      out += String.fromCharCode(parseInt(clean.substr(i, 4), 16));
    }
  } else {
    for (var j = 0; j < clean.length; j += 2) {
      out += String.fromCharCode(parseInt(clean.substr(j, 2), 16));
    }
  }
  return out;
}

function importPdfCmap(text, map) {
  var charBlocks = text.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
  charBlocks.forEach(function (block) {
    var pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    var hit;
    while ((hit = pair.exec(block))) {
      map[hit[1].toUpperCase()] = importPdfHexToText(hit[2]);
    }
  });
  var rangeBlocks = text.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
  rangeBlocks.forEach(function (block) {
    var line = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    var hit;
    while ((hit = line.exec(block))) {
      var width = hit[1].length;
      var lo = parseInt(hit[1], 16);
      var hi = parseInt(hit[2], 16);
      if (hi < lo || hi - lo > 4000) continue;
      if (hit[3]) {
        var baseCodes = hit[3];
        for (var code = lo; code <= hi; code++) {
          var target = importPdfHexToText(baseCodes);
          var last = target.slice(-1);
          var prefix = target.slice(0, -1);
          var shifted = prefix + String.fromCharCode(last.charCodeAt(0) + (code - lo));
          map[(code.toString(16).toUpperCase()).padStart(width, "0")] = shifted;
        }
      } else {
        var items = (hit[4].match(/<([0-9A-Fa-f]+)>/g) || []).map(function (item) {
          return item.slice(1, -1);
        });
        items.forEach(function (hex, pos) {
          map[((lo + pos).toString(16).toUpperCase()).padStart(width, "0")] = importPdfHexToText(hex);
        });
      }
    }
  });
}

function importPdfDecodeBytes(codes, map, twoByte) {
  var out = "";
  if (twoByte) {
    if (codes.length % 2 !== 0) codes = codes.slice(0, codes.length - 1);
    for (var i = 0; i < codes.length; i += 2) {
      var key = ((codes[i] << 8) | codes[i + 1]).toString(16).toUpperCase().padStart(4, "0");
      out += map[key] != null ? map[key] : "";
    }
    return out;
  }
  for (var j = 0; j < codes.length; j++) {
    var single = codes[j].toString(16).toUpperCase().padStart(2, "0");
    if (map[single] != null) out += map[single];
    else if (!Object.keys(map).length) out += String.fromCharCode(codes[j]);
  }
  return out;
}

function importPdfLiteralToCodes(literal) {
  var codes = [];
  for (var i = 0; i < literal.length; i++) {
    var ch = literal[i];
    if (ch !== "\\") {
      codes.push(literal.charCodeAt(i) & 0xff);
      continue;
    }
    var next = literal[++i];
    if (next === "n") codes.push(10);
    else if (next === "r") codes.push(13);
    else if (next === "t") codes.push(9);
    else if (next === "b") codes.push(8);
    else if (next === "f") codes.push(12);
    else if (next === "\n") continue;
    else if (/[0-7]/.test(next)) {
      var oct = next;
      while (oct.length < 3 && /[0-7]/.test(literal[i + 1] || "")) {
        oct += literal[++i];
      }
      codes.push(parseInt(oct, 8) & 0xff);
    } else codes.push(next.charCodeAt(0) & 0xff);
  }
  return codes;
}

function importPdfContent(content, map, out) {
  var twoByte = Object.keys(map).some(function (key) {
    return key.length >= 4;
  });
  var token =
    /\((?:\\.|[^\\()])*\)\s*Tj|<\s*[0-9A-Fa-f\s]+>\s*Tj|\[(?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|[^\]])*\]\s*TJ|\bBT\b|\bET\b|\bT\*\b/g;
  var hit;
  while ((hit = token.exec(content))) {
    var raw = hit[0];
    if (/^(BT|ET|T\*)/.test(raw)) {
      out.push("\n");
      continue;
    }
    if (raw.charAt(0) === "[") {
      var inner = raw.slice(1, raw.lastIndexOf("]"));
      var part = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?[0-9.]+)/g;
      var piece;
      while ((piece = part.exec(inner))) {
        var value = piece[1];
        if (value.charAt(0) === "(") {
          out.push(
            importPdfDecodeBytes(importPdfLiteralToCodes(value.slice(1, -1)), map, twoByte)
          );
        } else if (value.charAt(0) === "<") {
          out.push(importPdfDecodeHex(value, map, twoByte));
        } else if (parseFloat(value) < -180) {
          out.push(" ");
        }
      }
      continue;
    }
    if (raw.charAt(0) === "(") {
      out.push(
        importPdfDecodeBytes(importPdfLiteralToCodes(raw.slice(1, raw.lastIndexOf(")"))), map, twoByte)
      );
    } else {
      out.push(importPdfDecodeHex(raw, map, twoByte));
    }
  }
}

function importPdfDecodeHex(token, map, twoByte) {
  var hex = token.slice(1, token.lastIndexOf(">")).replace(/\s+/g, "");
  var codes = [];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    codes.push(parseInt(hex.substr(i, 2), 16));
  }
  return importPdfDecodeBytes(codes, map, twoByte);
}

function importPdfText(buffer) {
  var bytes = new Uint8Array(buffer);
  var raw = importLatin1(bytes);
  var jobs = [];
  var index = 0;
  while (true) {
    var at = raw.indexOf("stream", index);
    if (at < 0) break;
    var end = raw.indexOf("endstream", at + 6);
    if (end < 0) break;
    var dictStart = raw.lastIndexOf("<<", at);
    var dict = raw.slice(Math.max(0, dictStart), at);
    var dataStart = at + 6;
    if (raw.charCodeAt(dataStart) === 13) dataStart++;
    if (raw.charCodeAt(dataStart) === 10) dataStart++;
    jobs.push({ dict: dict, data: bytes.subarray(dataStart, end) });
    index = end + 9;
  }
  if (!jobs.length) return Promise.reject(new Error("这个 PDF 打不开，换个文件试试"));
  return Promise.all(
    jobs.map(function (job) {
      if (/FlateDecode/.test(job.dict)) {
        return importInflate(job.data, "deflate");
      }
      return Promise.resolve(job.data);
    })
  ).then(function (streams) {
    var map = {};
    var contents = [];
    streams.forEach(function (data) {
      if (!data || !data.length) return;
      var text = importLatin1(data);
      if (text.indexOf("beginbfchar") >= 0 || text.indexOf("beginbfrange") >= 0) {
        importPdfCmap(text, map);
      }
      if (text.indexOf("BT") >= 0 && (text.indexOf("Tj") >= 0 || text.indexOf("TJ") >= 0)) {
        contents.push(text);
      }
    });
    var out = [];
    contents.forEach(function (content) {
      importPdfContent(content, map, out);
    });
    var text = out
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.replace(/\s/g, "").length < 30) {
      throw new Error("这个 PDF 里没有读出文字，可能是扫描件或图片版。可以换成 Word / 文本再试。");
    }
    return text;
  });
}

function importReadFile(file) {
  var name = String(file.name || "").toLowerCase();
  return file.arrayBuffer().then(function (buffer) {
    if (/\.(docx)$/.test(name)) return importDocxText(buffer);
    if (/\.(pdf)$/.test(name)) return importPdfText(buffer);
    if (/\.(txt|md|markdown)$/.test(name)) return importDecodeText(new Uint8Array(buffer));
    var head = new Uint8Array(buffer.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b) return importDocxText(buffer);
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      return importPdfText(buffer);
    }
    return importDecodeText(new Uint8Array(buffer));
  });
}

/* ---------- 交给 AI 整理 ---------- */

function importSystemPrompt(kind) {
  var common =
    "你是一个严格的资料整理员。用户会给你一段文件内容（小说、设定集、人物卡），" +
    "你要把它整理成 JSON。规则：\n" +
    "1. 只使用原文明确写出的信息。原文没有提到的字段，必须留空字符串 \"\"；没有内容的数组留空 []。\n" +
    "2. 绝对不许新增原文没有的名字、地点、数值、组织、关系、规则或设定；不许润色、扩写、翻译、改名，也不许把推测写成事实。\n" +
    "3. 原文的句子尽量原样保留，只做必要的分句和归位。\n" +
    "4. 只输出一个 JSON 对象，不要任何解释，不要代码块标记。\n";
  if (kind === "persona") {
    return (
      common +
      "字段：{\"name\":\"\",\"type\":\"user 或 npc\",\"gender\":\"男/女/双/无性/留空\",\"age\":\"\",\"height\":\"\",\"weight\":\"\",\"appearance\":\"\",\"personality\":\"\",\"figure\":\"\",\"inner\":\"\",\"history\":\"\",\"abilities\":[]}\n" +
      "gender 只有原文明确写了才填，否则留空字符串。type 拿不准就留 \"npc\"。\n" +
      "height / weight / age 只写数字（例如 \"168\"），原文没写就留空。\n" +
      "abilities 只放原文写到的特殊能力，没写就 []。"
    );
  }
  return (
    common +
    "字段：{\"name\":\"\",\"description\":\"\",\"region\":\"\",\"currency\":\"\",\"npcs\":[{\"name\":\"\",\"age\":\"\",\"gender\":\"\",\"persona\":\"\"}],\"rules\":[{\"title\":\"\",\"content\":\"\"}]}"
  );
}

function importFieldText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function importWorldFromPayload(payload, fileName) {
  var data = payload && typeof payload === "object" ? payload : {};
  var npcs = (Array.isArray(data.npcs) ? data.npcs : [])
    .filter(function (npc) {
      return npc && (importFieldText(npc.name) || importFieldText(npc.persona));
    })
    .map(function (npc) {
      return {
        id: uid("n"),
        name: importFieldText(npc.name),
        age: importFieldText(npc.age),
        gender: GENDERS.indexOf(npc.gender) >= 0 ? npc.gender : importFieldText(npc.gender) ? "男" : "",
        persona: importFieldText(npc.persona)
      };
    });
  var rules = (Array.isArray(data.rules) ? data.rules : [])
    .filter(function (rule) {
      return rule && (importFieldText(rule.title) || importFieldText(rule.content));
    })
    .map(function (rule) {
      return {
        id: uid("r"),
        title: importFieldText(rule.title),
        content: importFieldText(rule.content)
      };
    });
  var name = importFieldText(data.name) || fileName.replace(/\.[^.]+$/, "");
  return {
    id: uid("w"),
    name: name,
    description: importFieldText(data.description || data.desc),
    region: importFieldText(data.region),
    currency: importFieldText(data.currency),
    groupId: null,
    sourcePrompt: "从文件导入：" + fileName,
    fusedFrom: [],
    npcs: npcs,
    rules: rules,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function importPersonaFromPayload(payload, fileName) {
  var data = payload && typeof payload === "object" ? payload : {};
  var abilities = Array.isArray(data.abilities) ? data.abilities : [];
  return {
    id: uid("p"),
    type: data.type === "user" ? "user" : "npc",
    name: importFieldText(data.name) || fileName.replace(/\.[^.]+$/, ""),
    age: importFieldText(data.age),
    gender: GENDERS.indexOf(data.gender) >= 0 ? data.gender : "",
    height: importFieldText(data.height),
    weight: importFieldText(data.weight),
    appearance: importFieldText(data.appearance),
    personality: importFieldText(data.personality),
    figure: importFieldText(data.figure),
    inner: importFieldText(data.inner),
    history: importFieldText(data.history),
    abilities: abilities
      .map(function (item) {
        return importFieldText(item);
      })
      .filter(Boolean)
      .slice(0, 8),
    persona: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function startAIImport(file) {
  if (!file || importBusy) return;
  importBusy = true;
  var kind = importKind;
  showToast("正在读取「" + file.name + "」…");
  importReadFile(file)
    .then(function (text) {
      var body = String(text || "").trim();
      if (body.replace(/\s/g, "").length < 20) {
        throw new Error("这个文件里没有读到可用的文字。");
      }
      var clipped = body.length > 12000;
      if (clipped) body = body.slice(0, 12000);
      aiBusy = true;
      aiTaskInfo = {
        label: kind === "persona" ? "正在整理人设" : "正在整理世界观",
        doneTitle: "界书 · 文件已整理"
      };
      showAILoading(
        kind === "persona" ? "正在整理人设" : "正在整理世界观",
        "只按文件里写的内容整理，不会自行补充。"
      );
      return aiChat(
        [
          { role: "system", content: importSystemPrompt(kind) },
          {
            role: "user",
            content:
              "文件名：" +
              file.name +
              "\n\n文件内容：\n" +
              body +
              (clipped ? "\n\n（内容过长，已截取前 12000 字）" : "")
          }
        ],
        { temperature: 0.2, maxTokens: 2600 }
      )
        .then(function (reply) {
          return importParseWithRetry(reply, kind).catch(function (error) {
            if (isAICancelError(error)) throw error;
            var fallback = importFallbackPayload(kind, body, file.name);
            fallback.__fallback = true;
            return fallback;
          });
        })
        .then(function (payload) {
          var loose = !!(payload && payload.__fallback);
          if (kind === "persona") {
            var persona = importPersonaFromPayload(payload, file.name);
            db.personas.push(persona);
            persist(true);
            renderPersonas();
            showScreen("personas");
            openPersonaEditor(persona.id);
            showToast(loose ? "AI 没整理成结构，已把原文放进「过往」，请手动整理" : "已导入人设，请核对字段");
            finishAITaskUI(true, "人设「" + (persona.name || "未命名") + "」已从文件导入。");
          } else {
            var world = importWorldFromPayload(payload, file.name);
            db.worlds.push(world);
            touch(world);
            persist(true);
            renderWorlds();
            setTabUI("worlds");
            showScreen("worlds");
            openEditor(world.id, false);
            showToast(loose ? "AI 没整理成结构，已把原文放进「概述」，请手动整理" : "已导入世界观，请核对内容");
            finishAITaskUI(true, "世界「" + displayWorldName(world) + "」已从文件导入。");
          }
        });
    })
    .catch(function (error) {
      if (isAICancelError(error)) {
        finishAITaskUI(false);
        return;
      }
      finishAITaskUI(false, "这次没有导入成功。");
      alertDialog({
        title: "这次没有导入成功",
        message: error && error.message ? error.message : friendlyAIError(error),
        confirmText: "知道了"
      });
    })
    .then(function () {
      importBusy = false;
    });
}

function parseAIJSONLoose(reply) {
  var text = String(reply || "").trim();
  var fenced = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/```/g, "").trim();
  var start = text.indexOf("{");
  var end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  var slice = text.slice(start, end + 1);
  var variants = [
    slice,
    slice.replace(/,\s*([}\]])/g, "$1"),
    slice
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
  ];
  var lastError = null;
  for (var i = 0; i < variants.length; i++) {
    try {
      return JSON.parse(variants[i]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("no json");
}

function importRepairPrompt(kind) {
  var shape =
    kind === "persona"
      ? '{"name":"","type":"user 或 npc","gender":"","age":"","height":"","weight":"","appearance":"","personality":"","figure":"","inner":"","history":"","abilities":[]}'
      : '{"name":"","description":"","region":"","currency":"","npcs":[{"name":"","age":"","gender":"","persona":""}],"rules":[{"title":"","content":""}]}';
  return (
    "你是格式转换器。把用户给出的内容原样整理成一个 JSON 对象，只输出这个 JSON，不要解释、不要代码块、不要注释。\n" +
    "不许新增、不许润色、不许翻译、不许猜测；原文没有的字段一律输出空字符串，没有内容的列表输出 []。\n" +
    "格式：" +
    shape
  );
}

function importParseWithRetry(reply, kind) {
  try {
    return Promise.resolve(parseAIJSONLoose(reply));
  } catch (error) {
    /* 第一次没解出来，让模型只做一次格式转换 */
  }
  return aiChat(
    [
      { role: "system", content: importRepairPrompt(kind) },
      { role: "user", content: String(reply || "").slice(0, 6000) }
    ],
    { temperature: 0, maxTokens: 2200 }
  ).then(function (second) {
    return parseAIJSONLoose(second);
  });
}

function importFallbackPayload(kind, body, fileName) {
  var base = String(fileName || "").replace(/\.[^.]+$/, "").trim();
  var text = String(body || "").trim().slice(0, 900);
  if (kind === "persona") {
    return {
      name: base || "未命名角色",
      type: "npc",
      gender: "",
      age: "",
      height: "",
      weight: "",
      appearance: "",
      personality: "",
      figure: "",
      inner: "",
      history: text,
      abilities: []
    };
  }
  return {
    name: base || "未命名世界",
    description: text,
    region: "",
    currency: "",
    npcs: [],
    rules: []
  };
}

function parseAIImport(reply) {
  return parseAIJSONLoose(reply);
}

function openImportSheet() {
  var root = $("#sheet-root");
  if (!root) return;
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet import-sheet" role="dialog" aria-modal="true" aria-label="AI 导入">' +
    '<div class="sheet-grab"></div>' +
    '<span class="eyebrow">IMPORT WITH AI</span>' +
    "<h3>AI 导入</h3>" +
    '<p class="sheet-desc">选一份文件，AI 会把它读成设定。只会照抄文件里写的东西——没提到的字段会留空。</p>' +
    '<div class="backup-options">' +
    '<button class="backup-option" type="button" data-import-kind="world">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.4 2.3 3.7 5.2 3.7 8.4s-1.3 6.1-3.7 8.4c-2.4-2.3-3.7-5.2-3.7-8.4S9.6 5.9 12 3.6z"/></svg></span>' +
    '<span class="bo-main"><strong>导入为世界观</strong><span>名称、概述、地区、货币、NPC、规则</span></span>' +
    '<span class="bo-chev"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>' +
    "</button>" +
    '<button class="backup-option" type="button" data-import-kind="persona">' +
    '<span class="bo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.4" r="3.6"/><path d="M5.2 20c0-3.3 3-5.6 6.8-5.6s6.8 2.3 6.8 5.6"/></svg></span>' +
    '<span class="bo-main"><strong>导入为人设</strong><span>姓名、性别、年龄、身高体重与各段设定</span></span>' +
    '<span class="bo-chev"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>' +
    "</button>" +
    "</div>" +
    '<p class="backup-tip">支持 .docx / .txt / .md / .pdf。文件里没提到的内容不会被补上；导入后可以自己再改。</p>' +
    '<div class="sheet-actions">' +
    '<button class="btn ghost" type="button" data-close-sheet>取消</button>' +
    "</div></div>";

  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  $$("[data-close-sheet]", root).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  $$("[data-import-kind]", root).forEach(function (button) {
    button.addEventListener("click", function () {
      importKind = button.dataset.importKind === "persona" ? "persona" : "world";
      var picker = $("#import-file");
      if (picker) picker.click();
    });
  });
}

function initAIImport() {
  var picker = $("#import-file");
  if (picker) {
    picker.addEventListener("change", function () {
      var file = picker.files && picker.files[0];
      picker.value = "";
      if (!file) return;
      closeSheet();
      setTimeout(function () {
        startAIImport(file);
      }, 220);
    });
  }
  var banner = $("#ai-import-banner");
  if (banner) banner.addEventListener("click", openImportSheet);
}

initAIImport();
/* ---------- 键盘弹起：把正在输入的框顶到键盘上方 ---------- */

  function currentKeyboardHeight() {
    var value = getComputedStyle(document.documentElement).getPropertyValue("--kb-height");
    var px = parseFloat(value);
    return isNaN(px) ? 0 : px;
  }

  function scrollNodeFor(el) {
    var node = el.parentElement;
    while (node && node !== document.body) {
      var style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight - node.clientHeight > 4) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function ensureFocusedVisible() {
    var el = document.activeElement;
    if (!el) return;
    var tag = (el.tagName || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return;
    var keyboard = currentKeyboardHeight();
    if (keyboard < 40) return;
    var rect = el.getBoundingClientRect();
    var limit = window.innerHeight - keyboard - 16;
    var delta = rect.bottom - limit;
    if (delta <= 0) return;
    var scroller = scrollNodeFor(el);
    if (scroller) scroller.scrollTop += delta + 8;
    else window.scrollBy(0, delta + 8);
  }

  window.onKeyboardHeight = function (px) {
    var height = Math.max(0, Number(px) || 0);
    document.documentElement.style.setProperty("--kb-height", height + "px");
    if (height <= 0) return;
    setTimeout(ensureFocusedVisible, 60);
    setTimeout(ensureFocusedVisible, 260);
    var chat = document.getElementById("view-chat");
    if (chat && chat.classList.contains("active")) {
      var scroller = document.getElementById("chat-scroll");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
  };

  document.addEventListener("focusin", function (event) {
    var tag = ((event.target && event.target.tagName) || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return;
    setTimeout(ensureFocusedVisible, 140);
  });

  window.addEventListener("resize", function () {
    setTimeout(ensureFocusedVisible, 120);
  });

/* ---------------- 应用身份 / 余额 / 使用记录 ---------------- */
var AI_PRICE = [
  { match: /deepseek-reasoner/i, in: 4, out: 16 },
  { match: /deepseek/i, in: 2, out: 8 },
  { match: /qwen-max/i, in: 2.4, out: 9.6 },
  { match: /qwen-plus/i, in: 0.8, out: 2 },
  { match: /qwen-turbo/i, in: 0.3, out: 0.6 },
  { match: /qwen/i, in: 0.8, out: 2 },
  { match: /moonshot|kimi/i, in: 12, out: 12 },
  { match: /glm-4/i, in: 1, out: 1 },
  { match: /gpt-4o-mini/i, in: 1.1, out: 4.3 },
  { match: /gpt-4o/i, in: 18, out: 72 }
];

function aiPriceFor(model) {
  var name = String(model || "");
  for (var i = 0; i < AI_PRICE.length; i += 1) {
    if (AI_PRICE[i].match.test(name)) return AI_PRICE[i];
  }
  return null;
}

function aiUsageCost(promptTokens, completionTokens, model) {
  var price = aiPriceFor(model);
  if (!price) return null;
  return (
    (Number(promptTokens) || 0) * price.in / 1000000 +
    (Number(completionTokens) || 0) * price.out / 1000000
  );
}

function aiMoney(value, currency) {
  if (value === null || value === undefined || isNaN(Number(value))) return "—";
  var num = Number(value);
  var fixed = Math.abs(num) < 0.01 ? num.toFixed(4) : num.toFixed(2);
  var unit = currency === "USD" ? "$" : "¥";
  return unit + fixed;
}

function recordAIUsage(text, request) {
  var payload = null;
  try {
    payload = JSON.parse(String(text || ""));
  } catch (error) {
    return;
  }
  var usage = payload && payload.usage;
  if (!usage) return;
  var promptTokens = Number(usage.prompt_tokens || 0);
  var completionTokens = Number(usage.completion_tokens || 0);
  if (!promptTokens && !completionTokens) return;
  if (!db.usage) db.usage = [];
  db.usage.push({
    at: Date.now(),
    model: String((request && request.model) || ""),
    tag: String((request && request.tag) || "AI"),
    prompt: promptTokens,
    completion: completionTokens,
    total: Number(usage.total_tokens || promptTokens + completionTokens)
  });
  if (db.usage.length > 300) db.usage = db.usage.slice(-300);
  persist(false);
}

function aiUsageSummary() {
  var list = (db.usage || []).slice().reverse();
  var totalPrompt = 0;
  var totalCompletion = 0;
  var cost = 0;
  var exact = false;
  list.forEach(function (item) {
    totalPrompt += Number(item.prompt) || 0;
    totalCompletion += Number(item.completion) || 0;
    var c = aiUsageCost(item.prompt, item.completion, item.model);
    if (c !== null) {
      cost += c;
      exact = true;
    }
  });
  return {
    list: list,
    totalPrompt: totalPrompt,
    totalCompletion: totalCompletion,
    cost: exact ? cost : null
  };
}

function usageTimeText(ts) {
  var d = new Date(ts);
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function openUsageSheet() {
  var summary = aiUsageSummary();
  var rows = summary.list.length
    ? summary.list
        .map(function (item) {
          var cost = aiUsageCost(item.prompt, item.completion, item.model);
          return (
            '<div class="usage-row">' +
            '<div class="usage-main"><strong>' +
            esc(item.tag || "AI") +
            "</strong><span>" +
            esc(item.model || "未记录模型") +
            " · " +
            usageTimeText(item.at) +
            "</span></div>" +
            '<div class="usage-num"><span>' +
            (Number(item.prompt) || 0) +
            " → " +
            (Number(item.completion) || 0) +
            "</span><em>" +
            (cost === null ? "—" : aiMoney(cost)) +
            "</em></div>" +
            "</div>"
          );
        })
        .join("")
    : '<div class="usage-empty">还没有记录。调用一次 AI 之后，这里会显示每次消耗的 tokens 和估算费用。</div>';

  var root = document.getElementById("sheet-root");
  if (!root) return;
  root.innerHTML =
    '<div class="sheet-backdrop" data-close-sheet></div>' +
    '<div class="sheet usage-sheet" role="dialog" aria-modal="true" aria-label="使用记录">' +
    '<div class="sheet-grab"></div>' +
    '<span class="eyebrow">USAGE</span>' +
    "<h3>使用记录</h3>" +
    '<p class="sheet-desc">只记录在这台设备上发起的调用，按服务商公开的每百万 tokens 单价估算，仅供参考。</p>' +
    '<div class="usage-total"><div><span>输入 tokens</span><strong>' +
    summary.totalPrompt +
    "</strong></div><div><span>输出 tokens</span><strong>" +
    summary.totalCompletion +
    "</strong></div><div><span>估算费用</span><strong>" +
    aiMoney(summary.cost) +
    "</strong></div></div>" +
    '<div class="usage-list">' +
    rows +
    "</div>" +
    '<div class="sheet-actions"><button class="btn ghost" type="button" data-close-sheet>关闭</button>' +
    (summary.list.length
      ? '<button class="btn ghost" type="button" id="clear-usage">清空记录</button>'
      : "") +
    "</div></div>";
  requestAnimationFrame(function () {
    root.classList.add("open");
  });
  [].slice.call(root.querySelectorAll("[data-close-sheet]")).forEach(function (el) {
    el.addEventListener("click", closeSheet);
  });
  var clearBtn = document.getElementById("clear-usage");
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      confirmDialog({
        title: "清空使用记录",
        message: "只清空这台设备上的统计，不影响你的世界、人设和对话。",
        confirmText: "清空",
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        db.usage = [];
        persist(true);
        closeSheet();
        showToast("使用记录已清空");
      });
    });
  }
}

function balanceEndpoint(url) {
  var base = String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
  if (/api\.deepseek\.com/i.test(base)) {
    return { url: "https://api.deepseek.com/user/balance", kind: "deepseek" };
  }
  if (/moonshot/i.test(base)) {
    return { url: base.replace(/\/v1$/i, "") + "/v1/users/me/balance", kind: "moonshot" };
  }
  if (/api\.openai\.com/i.test(base)) {
    return { url: base.replace(/\/v1$/i, "") + "/v1/dashboard/billing/subscription", kind: "openai" };
  }
  return null;
}

function parseBalance(kind, text) {
  var data = null;
  try {
    data = JSON.parse(String(text || ""));
  } catch (error) {
    return null;
  }
  if (kind === "deepseek") {
    var infos = data.balance_infos || [];
    var info = infos[0] || {};
    var total = info.total_balance;
    return {
      available: data.is_available !== false,
      amount: aiMoney(total, info.currency || "CNY"),
      detail: "充值 " + aiMoney(info.topped_up_balance, info.currency || "CNY") +
        " · 赠送 " + aiMoney(info.granted_balance, info.currency || "CNY")
    };
  }
  if (kind === "moonshot") {
    var d = (data && data.data) || {};
    return {
      available: true,
      amount: aiMoney(d.available_balance, "CNY"),
      detail: "现金 " + aiMoney(d.cash_balance, "CNY") + " · 代金券 " + aiMoney(d.voucher_balance, "CNY")
    };
  }
  if (kind === "openai") {
    return { available: true, amount: "见控制台", detail: "OpenAI 不提供余额接口，请到 platform.openai.com 查看用量" };
  }
  return null;
}

function queryAIBalance() {
  var result = document.getElementById("ai-balance-result");
  var button = document.getElementById("ai-balance-btn");
  if (!isAIConfigured()) {
    if (result) result.textContent = "先在下面填好 API Key 与接口地址。";
    return;
  }
  var config = aiConfig();
  var target = balanceEndpoint(config.url);
  if (!target) {
    if (result) result.textContent = "这家服务商没有公开的余额接口，请到它的控制台查看。";
    return;
  }
  if (result) result.textContent = "正在查询…";
  if (button) button.disabled = true;
  aiHttpGet(target.url, config.key.trim())
    .then(function (res) {
      var parsed = parseBalance(target.kind, res.body);
      if (!parsed) {
        if (result) result.textContent = "查询失败：返回内容看不懂。";
        return;
      }
      if (result) {
        result.innerHTML =
          '<strong>' + esc(parsed.amount) + "</strong><span>" + esc(parsed.detail) + "</span>";
      }
    })
    .catch(function (error) {
      if (result) result.textContent = "查询失败：" + friendlyAIError(error);
    })
    .then(function () {
      if (button) button.disabled = false;
    });
}

/* ---------- 应用名称 / 图标 ---------- */
function appIdentity() {
  if (!db.settings) db.settings = {};
  if (!db.settings.app) db.settings.app = { name: "", icon: "" };
  return db.settings.app;
}

function applyAppIdentity() {
  var app = appIdentity();
  var name = String(app.name || "").trim() || "界书";
  var title = document.getElementById("brand-title");
  if (title) title.textContent = name;
  var mark = document.getElementById("open-settings");
  if (mark) {
    if (app.icon) {
      mark.innerHTML = '<img class="brand-logo" src="' + app.icon + '" alt="' + esc(name) + '">';
    } else {
      mark.textContent = "界";
    }
  }
  var cardMark = document.getElementById("app-mark");
  if (cardMark) {
    cardMark.innerHTML = app.icon ? '<img src="' + app.icon + '" alt="">' : "界";
  }
  var about = document.querySelector(".about-card .about-meta span");
  if (about) about.textContent = name;
  document.title = name + " · 世界观与角色";
}

function saveAppIdentity(patch) {
  var app = appIdentity();
  if (patch.name !== undefined) app.name = patch.name;
  if (patch.icon !== undefined) app.icon = patch.icon;
  persist(true);
  applyAppIdentity();
}

function initAppIdentity() {
  applyAppIdentity();
  var nameInput = document.getElementById("app-name");
  if (nameInput) {
    nameInput.value = appIdentity().name || "";
    nameInput.addEventListener("change", function () {
      var value = nameInput.value.trim().slice(0, 12);
      nameInput.value = value;
      saveAppIdentity({ name: value });
      var status = document.getElementById("app-identity-status");
      if (status) status.textContent = value ? "已改名为「" + value + "」" : "已恢复默认名称「界书」";
    });
  }

  var fileInput = document.getElementById("app-icon-file");
  var choose = document.getElementById("choose-app-icon");
  if (choose && fileInput) {
    choose.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var image = new Image();
        image.onload = function () {
          var size = 192;
          var canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext("2d");
          var scale = Math.max(size / image.width, size / image.height);
          var w = image.width * scale;
          var h = image.height * scale;
          ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.86);
          saveAppIdentity({ icon: dataUrl });
          var status = document.getElementById("app-identity-status");
          if (status) status.textContent = "图标已更新";
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
      fileInput.value = "";
    });
  }

  var reset = document.getElementById("reset-app-icon");
  if (reset) {
    reset.addEventListener("click", function () {
      saveAppIdentity({ icon: "" });
      var status = document.getElementById("app-identity-status");
      if (status) status.textContent = "图标已恢复默认";
    });
  }

  var pin = document.getElementById("pin-app");
  if (pin) {
    pin.addEventListener("click", function () {
      var app = appIdentity();
      var name = String(app.name || "").trim() || "界书";
      var status = document.getElementById("app-identity-status");
      if (window.AndroidTheme && typeof window.AndroidTheme.pinShortcut === "function") {
        var ok = window.AndroidTheme.pinShortcut(name, app.icon || "");
        if (status) {
          status.textContent = ok
            ? "已请求添加到桌面：如果出现确认框，点「添加」即可"
            : "这台设备不支持自定义快捷方式";
        }
      } else {
        if (status) status.textContent = "桌面快捷方式只在手机应用里可用";
      }
    });
  }

  var balanceBtn = document.getElementById("ai-balance-btn");
  if (balanceBtn) balanceBtn.addEventListener("click", queryAIBalance);
  var usageBtn = document.getElementById("ai-usage-btn");
  if (usageBtn) usageBtn.addEventListener("click", openUsageSheet);
}

/* ---------- 首次打开自动进入手册 ---------- */
function maybeFirstRunGuide() {
  if (guideSeen()) return;
  if (!(window.AndroidStore || window.AndroidBackup || window.AndroidChat || window.AndroidTheme)) return;
  setTimeout(function () {
    if (guideSeen()) return;
    var active = document.querySelector(".screen.active");
    if (active && active.id !== "view-worlds") return;
    openGuide();
  }, 3400);
}

initAppIdentity();
maybeFirstRunGuide();

})();
