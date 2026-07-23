/* Data model + layout math for the life timeline. No framework, no build step. */

var TimelineData = (function () {
  "use strict";

  var STORAGE_KEY = "timeline.experiences.v3";
  var BACKUP_KEY = "timeline.experiences.backup";

  var _fileData = null; // populated by init() from data.json
  var _ready = false;
  var _readyCallbacks = [];

  function readStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeStorage(list) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) { }
  }

  function allExperiences() {
    return readStorage(STORAGE_KEY) || (_fileData ? _fileData.slice() : []);
  }

  function addExperience(exp) {
    var list = allExperiences();
    list.push(exp);
    writeStorage(list);
  }

  function updateExperience(exp) {
    var list = allExperiences().map(function (e) {
      return e.id === exp.id ? exp : e;
    });
    writeStorage(list);
  }

  function deleteExperience(id) {
    var list = allExperiences().filter(function (e) {
      return e.id !== id;
    });
    writeStorage(list);
  }

  function snapshotBackup() {
    var current = readStorage(STORAGE_KEY);
    if (!current) return;
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        data: current
      }));
    } catch (e) { }
  }

  function backupInfo() {
    try {
      var raw = window.localStorage.getItem(BACKUP_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.data)) return null;
      return { savedAt: parsed.savedAt || null, count: parsed.data.length };
    } catch (e) {
      return null;
    }
  }

  function restoreBackup() {
    try {
      var raw = window.localStorage.getItem(BACKUP_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.data)) return false;
      snapshotBackup();
      writeStorage(parsed.data);
      return true;
    } catch (e) {
      return false;
    }
  }

  function resetToDefaults() {
    snapshotBackup();
    if (_fileData) {
      writeStorage(_fileData);
    }
  }

  function importExperiences(list) {
    if (!Array.isArray(list)) return -1;
    var clean = list.filter(function (e) {
      return e && typeof e === "object" && e.title && e.start &&
        typeof e.start.year === "number" && typeof e.start.month === "number";
    });
    if (!clean.length) return -1;
    snapshotBackup();
    writeStorage(clean);
    return clean.length;
  }

  function exportJSON() {
    return JSON.stringify(allExperiences(), null, 2);
  }

  function onReady(cb) {
    if (_ready) { cb(); return; }
    _readyCallbacks.push(cb);
  }

  function _fireReady() {
    _ready = true;
    _readyCallbacks.forEach(function (cb) { cb(); });
    _readyCallbacks = [];
  }

  // If localStorage has data, render immediately. Otherwise fetch data.json.
  (function init() {
    if (readStorage(STORAGE_KEY)) {
      _fireReady();
      return;
    }
    fetch("data.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (Array.isArray(data) && data.length) {
          _fileData = data;
          writeStorage(data);
        }
      })
      .catch(function () { })
      .then(_fireReady);
  })();

  return {
    allExperiences: allExperiences,
    addExperience: addExperience,
    updateExperience: updateExperience,
    deleteExperience: deleteExperience,
    resetToDefaults: resetToDefaults,
    importExperiences: importExperiences,
    backupInfo: backupInfo,
    restoreBackup: restoreBackup,
    exportJSON: exportJSON,
    onReady: onReady
  };
})();

var Timeline = (function () {
  "use strict";

  var YEAR_HEIGHT = 68; // px per year, compressed & fixed regardless of real day counts
  var PX_PER_MONTH = YEAR_HEIGHT / 12;
  var LANE_WIDTH = 14;
  var LANE_GAP = 6;
  // Minimum bar height equals the width so the shortest bars render as full
  // circles (square + the 7px = 50% corner radius) rather than squeezed pills.
  var MIN_BAR_HEIGHT = LANE_WIDTH;
  var DOT_SIZE = 14;
  var LABEL_COL_WIDTH = 56;
  var TOP_PADDING = 30;
  var BOTTOM_PADDING = 40;

  var MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  function absMonths(y, m) {
    return y * 12 + (m - 1);
  }

  function formatDate(d) {
    if (d.day) {
      return MONTH_NAMES[d.month - 1] + " " + d.day + ", " + d.year;
    }
    return MONTH_NAMES[d.month - 1] + " " + d.year;
  }

  function formatPeriod(exp) {
    if (exp.highlight) {
      return formatDate(exp.start);
    }
    if (exp.ongoing) {
      return formatDate(exp.start) + " – Present";
    }
    var s = exp.start, e = exp.end;
    if (s.year === e.year && s.month === e.month) {
      return MONTH_NAMES[s.month - 1] + " " + s.year;
    }
    if (s.year === e.year) {
      return MONTH_NAMES[s.month - 1] + "–" + MONTH_NAMES[e.month - 1] + " " + s.year;
    }
    return formatDate(s) + " – " + formatDate(e);
  }

  var MAX_LANES = 4;

  function assignLanes(items) {
    var GAP = 0.5;
    // Place longest items first so they claim lanes early;
    // shorter items placed later will overlap on top.
    var sorted = items.slice().sort(function (a, b) {
      return (b._endAbs - b._startAbs) - (a._endAbs - a._startAbs);
    });

    var byId = {};
    sorted.forEach(function (it) { byId[it.exp.id] = it; });

    // Each lane tracks the lowest _startAbs placed without overlap.
    var lanes = [];

    sorted.forEach(function (it) {
      // Related items share their parent's lane
      var parent = it.exp.relatedTo ? byId[it.exp.relatedTo] : null;
      if (parent && parent._lane !== undefined) {
        it._lane = parent._lane;
        return;
      }

      // Manual lane override
      if (typeof it.exp.lane === "number" && it.exp.lane >= 0) {
        it._lane = Math.min(it.exp.lane, MAX_LANES - 1);
        while (lanes.length <= it._lane) lanes.push(-Infinity);
        return;
      }

      // Try to fit without overlap
      var placed = false;
      for (var l = 0; l < lanes.length; l++) {
        if (it._endAbs + GAP <= lanes[l]) {
          it._lane = l;
          lanes[l] = it._startAbs;
          placed = true;
          break;
        }
      }

      if (!placed && lanes.length < MAX_LANES) {
        it._lane = lanes.length;
        lanes.push(it._startAbs);
      } else if (!placed) {
        // All lanes full — pick the lane with least overlap
        var bestLane = 0, bestOverlap = Infinity;
        for (var l2 = 0; l2 < lanes.length; l2++) {
          var overlap = it._endAbs - lanes[l2];
          if (overlap < bestOverlap) { bestOverlap = overlap; bestLane = l2; }
        }
        it._lane = bestLane;
      }
    });

    return Math.max(lanes.length, 1);
  }

  function render(container, experiences, callbacks) {
    container.innerHTML = "";

    if (!experiences.length) {
      var empty = document.createElement("p");
      empty.className = "timeline-empty";
      empty.textContent = "No experiences yet.";
      container.appendChild(empty);
      return;
    }

    var now = new Date();
    var nowAbs = absMonths(now.getFullYear(), now.getMonth() + 1);

    var prepared = experiences.map(function (exp) {
      var startAbs = absMonths(exp.start.year, exp.start.month) +
        (exp.start.day ? (exp.start.day - 1) / 31 : 0);
      var endAbs = exp.highlight
        ? startAbs + 0.6
        : (exp.ongoing ? nowAbs : absMonths(exp.end.year, exp.end.month));
      if (endAbs < startAbs) endAbs = startAbs + 0.6;
      return {
        exp: exp,
        _startAbs: startAbs,
        _endAbs: endAbs
      };
    });

    var byId = {};
    prepared.forEach(function (item) { byId[item.exp.id] = item; });

    var minYear = experiences.reduce(function (min, e) {
      return Math.min(min, e.start.year);
    }, now.getFullYear());
    var maxYear = now.getFullYear();

    var laneCount = assignLanes(prepared);
    var lanesWidth = laneCount * LANE_WIDTH + (laneCount - 1) * LANE_GAP;
    var totalHeight = (nowAbs - absMonths(minYear, 1)) * PX_PER_MONTH + TOP_PADDING + BOTTOM_PADDING;

    function yFor(abs) {
      return (nowAbs - abs) * PX_PER_MONTH + TOP_PADDING;
    }

    var timelineEl = document.createElement("div");
    timelineEl.className = "timeline-inner";
    timelineEl.style.height = totalHeight + "px";
    var lineOverhang = LABEL_COL_WIDTH - 40;
    timelineEl.style.width = (LABEL_COL_WIDTH + lanesWidth + lineOverhang) + "px";

    // Year markers (horizontal lines only, no vertical guides)
    for (var y = maxYear; y >= minYear; y--) {
      var markerAbs = absMonths(y, 1);
      var markerY = yFor(markerAbs);
      if (markerY < TOP_PADDING - 1 || markerY > totalHeight - BOTTOM_PADDING + 20) continue;

      var marker = document.createElement("div");
      marker.className = "year-marker";
      marker.style.top = markerY + "px";

      var label = document.createElement("span");
      label.className = "year-label";
      label.textContent = y;
      marker.appendChild(label);

      var line = document.createElement("span");
      line.className = "year-line";
      line.style.width = (lanesWidth + 2 * lineOverhang) + "px";
      marker.appendChild(line);

      timelineEl.appendChild(marker);
    }

    // Bars & dots
    prepared.forEach(function (item) {
      var exp = item.exp;
      var parentItem = exp.relatedTo ? byId[exp.relatedTo] : null;
      var color = (parentItem ? parentItem.exp.color : exp.color) || exp.color;
      var left = LABEL_COL_WIDTH + item._lane * (LANE_WIDTH + LANE_GAP);
      var el = document.createElement("div");
      el.tabIndex = 0;
      el.dataset.id = exp.id;

      if (exp.highlight) {
        var cy = yFor(item._startAbs);
        el.className = "timeline-dot";
        el.style.left = (left + LANE_WIDTH / 2 - DOT_SIZE / 2) + "px";
        el.style.top = (cy - DOT_SIZE / 2) + "px";
        el.style.width = DOT_SIZE + "px";
        el.style.height = DOT_SIZE + "px";
        el.style.backgroundColor = color;
      } else {
        var topY = yFor(item._endAbs);
        var bottomY = yFor(item._startAbs);
        var span = bottomY - topY;
        el.className = "timeline-bar";
        el.style.left = left + "px";
        el.style.top = topY + "px";
        el.style.width = LANE_WIDTH + "px";
        el.style.height = Math.max(span, MIN_BAR_HEIGHT) + "px";
        el.style.backgroundColor = color;
      }

      // Shorter items render on top so they're never hidden by longer ones
      var duration = item._endAbs - item._startAbs;
      var maxDuration = nowAbs - absMonths(minYear, 1);
      var z = Math.round((1 - duration / maxDuration) * 100) + 1;
      el.style.zIndex = String(z);

      if (parentItem && parentItem !== item &&
          item._startAbs < parentItem._endAbs && item._endAbs > parentItem._startAbs) {
        el.className += " on-top";
      }

      if (callbacks && callbacks.onEnter) {
        el.addEventListener("mouseenter", function (ev) {
          callbacks.onEnter(exp, ev.currentTarget);
        });
        el.addEventListener("focus", function (ev) {
          callbacks.onEnter(exp, ev.currentTarget);
        });
      }
      if (callbacks && callbacks.onLeave) {
        el.addEventListener("mouseleave", function () {
          callbacks.onLeave();
        });
        el.addEventListener("blur", function () {
          callbacks.onLeave();
        });
      }
      if (callbacks && callbacks.onSelect) {
        el.addEventListener("click", function () {
          if (el._suppressClick) { el._suppressClick = false; return; }
          callbacks.onSelect(exp);
        });
        el.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            callbacks.onSelect(exp);
          }
        });
      }

      timelineEl.appendChild(el);
    });

    container.appendChild(timelineEl);
  }

  return {
    render: render,
    formatDate: formatDate,
    formatPeriod: formatPeriod
  };
})();
