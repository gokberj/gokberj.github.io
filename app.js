(function () {
  "use strict";

  var timelineEl = document.getElementById("timeline");
  var form = document.getElementById("experience-form");
  var addBtn = document.getElementById("add-btn");
  var cancelBtn = document.getElementById("cancel-btn");
  var exportBtn = document.getElementById("export-btn");
  var importFile = document.getElementById("import-file");
  var restoreBtn = document.getElementById("restore-btn");
  var resetBtn = document.getElementById("reset-btn");
  var statusEl = document.getElementById("form-status");

  var fTitle = document.getElementById("f-title");
  var fRole = document.getElementById("f-role");
  var fStart = document.getElementById("f-start");
  var fEnd = document.getElementById("f-end");
  var fOngoing = document.getElementById("f-ongoing");
  var fHighlight = document.getElementById("f-highlight");
  var fColor = document.getElementById("f-color");
  var colorSwatch = document.getElementById("color-swatch");
  var fNote = document.getElementById("f-note");
  var fUrl = document.getElementById("f-url");
  var fRelated = document.getElementById("f-related");
  var fTags = document.getElementById("f-tags");
  var fSection = document.getElementById("f-section");
  var fLane = document.getElementById("f-lane");
  var fDetails = document.getElementById("f-details");
  var rteToolbar = document.querySelector(".rte-toolbar");

  var accordionEl = document.getElementById("accordion");
  var fIcon = document.getElementById("f-icon");
  var iconPreview = document.getElementById("icon-preview");
  var iconClear = document.getElementById("icon-clear");
  var iconPickLabel = document.getElementById("icon-pick-label");
  var endWrap = document.getElementById("f-end-wrap");
  var ongoingWrap = document.getElementById("f-ongoing-wrap");

  var fPhotos = document.getElementById("f-photos");
  var photosPreview = document.getElementById("photos-preview");
  var fDocs = document.getElementById("f-docs");
  var docsPreview = document.getElementById("docs-preview");

  var IS_ADMIN = document.body.classList.contains("admin-page");

  var MAX_ICON_BYTES = 800 * 1024; // keep localStorage well under quota
  var MAX_PHOTO_PX = 1600;
  var MAX_DOC_BYTES = 2 * 1024 * 1024;

  var stagedPhotos = [];  // array of data URLs
  var stagedDocs = [];    // array of { name, dataUrl }

  // Two side-by-side columns in the details list. Each column stacks its
  // category groups. (These names also drive the timeline's left/right split,
  // so keep them in sync with LEFT_SECTIONS in timeline.js.)
  var DEFAULT_CATEGORY_COLUMNS = [
    ["Work Experience and Formal Education", "Projects"],
    ["Volunteering", "Memberships & Learning"]
  ];
  var OTHER_CATEGORY = "Other";

  function getCategoryColumns() {
    var all = TimelineData.allExperiences();
    var seen = {};
    all.forEach(function (e) { if (e.section) seen[e.section] = true; });
    var sections = Object.keys(seen);
    if (!sections.length) return DEFAULT_CATEGORY_COLUMNS;
    // Keep the first half in the left column and the second half in the
    // right column. The renderer then places matching positions on the same
    // row so their section rules stay horizontally aligned.
    var mid = Math.ceil(sections.length / 2);
    return [sections.slice(0, mid), sections.slice(mid)];
  }

  var CATEGORY_COLUMNS = DEFAULT_CATEGORY_COLUMNS;

  var editingId = null;
  var openId = null;    // id of the currently expanded accordion item
  var currentIcon = ""; // data URL of the icon staged in the form

  function endMonths(exp) {
    if (exp.ongoing) return Infinity;
    var d = exp.end || exp.start;
    return d.year * 12 + d.month;
  }

  function sortByEnd(a, b) {
    return endMonths(b) - endMonths(a);
  }

  /* ---------- rendering ---------- */

  function renderAll() {
    CATEGORY_COLUMNS = getCategoryColumns();
    refreshSectionDropdown();
    var experiences = TimelineData.allExperiences();
    Timeline.render(timelineEl, experiences, {
      onEnter: onTimelineEnter,
      onLeave: onTimelineLeave,
      onSelect: function (exp) { expandItem(exp.id, true); }
    });
    refreshRelatedOptions(experiences);
    renderAccordion(experiences);
  }

  function refreshSectionDropdown() {
    var current = fSection.value;
    var allCats = CATEGORY_COLUMNS.reduce(function (a, c) { return a.concat(c); }, []);
    fSection.innerHTML = '<option value="">— Uncategorized —</option>';
    allCats.forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      fSection.appendChild(opt);
    });
    if (current) fSection.value = current;
  }

  function renameSection(oldName, newName) {
    var all = TimelineData.allExperiences();
    all.forEach(function (e) {
      if (e.section === oldName) {
        e.section = newName;
        TimelineData.updateExperience(e);
      }
    });
    renderAll();
  }

  function highlightTimelineItem(id) {
    var prev = timelineEl.querySelector(".is-highlighted");
    if (prev) prev.classList.remove("is-highlighted");
    if (id) {
      var el = timelineEl.querySelector('[data-id="' + id + '"]');
      if (el) el.classList.add("is-highlighted");
    }
  }

  function findExperience(id) {
    if (!id) return null;
    var all = TimelineData.allExperiences();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function experienceTitle(id) {
    var e = findExperience(id);
    return e ? e.title : "";
  }

  function displayColor(exp) {
    if (exp.relatedTo) {
      var parent = findExperience(exp.relatedTo);
      if (parent) return parent.color;
    }
    return exp.color;
  }

  // Row display: role is the prominent (top) line, title + period the
  // secondary (bottom) line. Falls back to title when there's no role.
  function primaryLine(exp) {
    return exp.role || exp.title;
  }

  function secondaryLine(exp) {
    var period = Timeline.formatPeriod(exp);
    if (exp.role) return [exp.title, period].filter(Boolean).join(" · ");
    return period;
  }

  /* ---------- tags ---------- */

  function parseTags(str) {
    var seen = {};
    return (str || "").split(",").map(function (s) {
      return s.trim();
    }).filter(function (t) {
      if (!t) return false;
      var key = t.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function renderTagChips(container, tags) {
    container.innerHTML = "";
    (tags || []).forEach(function (t) {
      var chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = t;
      container.appendChild(chip);
    });
  }

  /* ---------- detail box ---------- */

  function renderAccordion(experiences) {
    accordionEl.innerHTML = "";

    if (!experiences.length) {
      var empty = document.createElement("p");
      empty.className = "acc-empty";
      empty.textContent = "No experiences yet.";
      accordionEl.appendChild(empty);
      return;
    }

    var sorted = experiences.slice().sort(sortByEnd);

    if (openId && !sorted.some(function (e) { return e.id === openId; })) {
      openId = null;
    }

    var columns = [
      CATEGORY_COLUMNS[0] || [],
      (CATEGORY_COLUMNS[1] || []).concat([OTHER_CATEGORY])
    ];

    columns.forEach(function (cats, ci) {
      var pane = document.createElement("div");
      pane.className = "acc-pane";

      cats.forEach(function (cat) {
        var inCat = sorted.filter(function (e) {
          return (e.section || OTHER_CATEGORY) === cat;
        });
        if (!inCat.length) return;

        var group = document.createElement("ul");
        group.className = "acc-col";
        group.dataset.categoryIndex = String(ci);

        var header = document.createElement("li");
        header.className = "acc-cat";
        header.textContent = cat;
        if (IS_ADMIN) {
          header.setAttribute("contenteditable", "true");
          header.setAttribute("spellcheck", "false");
          var _committed = false;
          function commitRename(catName, headerEl) {
            return function () {
              if (_committed) return;
              var newName = headerEl.textContent.replace(/\n/g, "").trim();
              if (!newName || newName === catName) {
                headerEl.textContent = catName;
                return;
              }
              _committed = true;
              renameSection(catName, newName);
            };
          }
          var renameFn = commitRename(cat, header);
          header.addEventListener("blur", renameFn);
          header.addEventListener("keydown", function (catName) {
            return function (ev) {
              if (ev.key === "Enter") { ev.preventDefault(); renameFn(); }
              if (ev.key === "Escape") { ev.preventDefault(); header.textContent = catName; header.blur(); }
            };
          }(cat));
        }
        group.appendChild(header);

        inCat.forEach(function (exp) {
          group.appendChild(buildAccordionItem(exp));
        });

        pane.appendChild(group);
      });

      accordionEl.appendChild(pane);
    });
  }

  function buildAccordionItem(exp) {
    var isOpen = exp.id === openId;

    var li = document.createElement("li");
    li.className = "acc-item";
    li.dataset.id = exp.id;

    // ----- header (styled to match the editing-pane rows) -----
    var header = document.createElement("button");
    header.type = "button";
    header.className = "acc-header";
    header.setAttribute("aria-expanded", isOpen ? "true" : "false");

    var swatch = document.createElement("span");
    swatch.className = "acc-swatch" + (exp.highlight ? " is-dot" : "");
    swatch.style.backgroundColor = displayColor(exp);
    header.appendChild(swatch);

    if (exp.icon) {
      var iconEl = document.createElement("img");
      iconEl.className = "acc-icon";
      iconEl.src = exp.icon;
      iconEl.alt = "";
      header.appendChild(iconEl);
    }

    var main = document.createElement("span");
    main.className = "acc-main";
    var titleEl = document.createElement("span");
    titleEl.className = "acc-title";
    titleEl.textContent = primaryLine(exp);
    var metaEl = document.createElement("span");
    metaEl.className = "acc-meta";
    metaEl.textContent = secondaryLine(exp);
    main.appendChild(titleEl);
    main.appendChild(metaEl);
    header.appendChild(main);

    if (IS_ADMIN) {
      header.addEventListener("click", function () {
        toggleItem(exp.id);
      });
    }
    header.addEventListener("mouseenter", function () {
      highlightTimelineItem(exp.id);
    });
    header.addEventListener("mouseleave", function () {
      highlightTimelineItem(null);
    });
    li.appendChild(header);

    // ----- body (revealed on expand) -----
    var body = document.createElement("div");
    body.className = "acc-body" + (isOpen ? " is-open" : "");

    var relTitle = experienceTitle(exp.relatedTo);
    if (relTitle) {
      var related = document.createElement("div");
      related.className = "acc-related";
      related.textContent = "Related to: ";
      var relLink = document.createElement("a");
      relLink.href = "#";
      relLink.className = "acc-related-link";
      relLink.textContent = relTitle;
      relLink.addEventListener("click", function (ev) {
        ev.preventDefault();
        highlightTimelineItem(exp.relatedTo);
        expandItem(exp.relatedTo, true);
      });
      relLink.addEventListener("mouseenter", function () {
        highlightTimelineItem(exp.relatedTo);
      });
      relLink.addEventListener("mouseleave", function () {
        highlightTimelineItem(null);
      });
      related.appendChild(relLink);
      body.appendChild(related);
    }

    if (exp.tags && exp.tags.length) {
      var tags = document.createElement("div");
      tags.className = "acc-tags";
      renderTagChips(tags, exp.tags);
      body.appendChild(tags);
    }

    if (exp.note) {
      var note = document.createElement("div");
      note.className = "acc-note";
      note.textContent = exp.note;
      body.appendChild(note);
    }

    if (exp.details) {
      var desc = document.createElement("div");
      desc.className = "acc-desc";
      desc.innerHTML = sanitizeHtml(exp.details);
      body.appendChild(desc);
    }

    if (exp.photos && exp.photos.length) {
      var gallery = document.createElement("div");
      gallery.className = "acc-gallery";
      var gImg = document.createElement("img");
      gImg.className = "acc-gallery-img";
      gImg.src = exp.photos[0];
      gImg.alt = "Photo 1 of " + exp.photos.length;
      gallery.appendChild(gImg);

      if (exp.photos.length > 1) {
        var gIdx = 0;
        var prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = "acc-gallery-arrow acc-gallery-prev";
        prevBtn.textContent = "‹";
        var nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "acc-gallery-arrow acc-gallery-next";
        nextBtn.textContent = "›";
        var dots = document.createElement("div");
        dots.className = "acc-gallery-dots";
        exp.photos.forEach(function (_, di) {
          var d = document.createElement("span");
          d.className = "acc-gallery-dot" + (di === 0 ? " active" : "");
          dots.appendChild(d);
        });

        var updateGallery = function () {
          gImg.src = exp.photos[gIdx];
          gImg.alt = "Photo " + (gIdx + 1) + " of " + exp.photos.length;
          var allDots = dots.querySelectorAll(".acc-gallery-dot");
          Array.prototype.forEach.call(allDots, function (d, di) {
            d.className = "acc-gallery-dot" + (di === gIdx ? " active" : "");
          });
        };

        prevBtn.addEventListener("click", function () {
          gIdx = (gIdx - 1 + exp.photos.length) % exp.photos.length;
          updateGallery();
        });
        nextBtn.addEventListener("click", function () {
          gIdx = (gIdx + 1) % exp.photos.length;
          updateGallery();
        });

        gallery.appendChild(prevBtn);
        gallery.appendChild(nextBtn);
        gallery.appendChild(dots);
      }
      body.appendChild(gallery);
    }

    if (exp.docs && exp.docs.length) {
      var docList = document.createElement("div");
      docList.className = "acc-docs";
      exp.docs.forEach(function (doc) {
        var a = document.createElement("a");
        a.className = "acc-doc-link";
        a.href = doc.dataUrl;
        a.download = doc.name;
        a.textContent = doc.name;
        docList.appendChild(a);
      });
      body.appendChild(docList);
    }

    if (exp.url) {
      var link = document.createElement("a");
      link.className = "acc-link";
      link.href = exp.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open link ↗";
      body.appendChild(link);
    }

    if (IS_ADMIN) {
      var secRow = document.createElement("div");
      secRow.className = "acc-section-row";
      var secLabel = document.createElement("span");
      secLabel.textContent = "Category:";
      secRow.appendChild(secLabel);
      var secSelect = document.createElement("select");
      var allCats = CATEGORY_COLUMNS.reduce(function (a, c) { return a.concat(c); }, []);
      allCats.forEach(function (cat) {
        var opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        if ((exp.section || "") === cat) opt.selected = true;
        secSelect.appendChild(opt);
      });
      secSelect.addEventListener("change", function () {
        exp.section = secSelect.value;
        TimelineData.updateExperience(exp);
        renderAll();
      });
      secRow.appendChild(secSelect);
      body.appendChild(secRow);

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "acc-edit";
      editBtn.textContent = "Edit this experience";
      editBtn.addEventListener("click", function () {
        startEdit(exp);
      });
      body.appendChild(editBtn);
    }

    li.appendChild(body);
    return li;
  }

  function toggleItem(id) {
    if (openId === id) {
      openId = null;
      syncAccordionOpenState();
    } else {
      expandItem(id, false);
    }
  }

  // Expand one item (single-open accordion); optionally scroll it into view.
  function expandItem(id, scrollIntoView) {
    openId = id;
    highlightTimelineItem(id);
    syncAccordionOpenState();
    if (scrollIntoView) {
      var item = accordionEl.querySelector('.acc-item[data-id="' + id + '"]');
      if (item) item.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // Reflect openId onto the DOM without rebuilding the list.
  function syncAccordionOpenState() {
    var items = accordionEl.querySelectorAll(".acc-item");
    Array.prototype.forEach.call(items, function (item) {
      var isOpen = item.dataset.id === openId;
      item.querySelector(".acc-header").setAttribute("aria-expanded", isOpen ? "true" : "false");
      item.querySelector(".acc-body").classList.toggle("is-open", isOpen);
    });
  }

  function refreshRelatedOptions(experiences) {
    var list = (experiences || TimelineData.allExperiences()).slice().sort(sortByEnd);
    var current = fRelated.value;
    fRelated.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "— None —";
    fRelated.appendChild(none);
    list.forEach(function (e) {
      if (e.id === editingId) return; // an experience can't relate to itself
      var opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.title;
      fRelated.appendChild(opt);
    });
    fRelated.value = current;
    if (fRelated.value !== current) fRelated.value = ""; // referenced entry is gone
  }

  /* ---------- accordion hover highlight ---------- */

  function highlightAccordionItem(id) {
    var prev = document.querySelector(".acc-item.is-hover-highlight");
    if (prev) prev.classList.remove("is-hover-highlight");
    if (id) {
      var item = document.querySelector('.acc-item[data-id="' + id + '"]');
      if (item) item.classList.add("is-hover-highlight");
    }
  }

  function onTimelineEnter(exp) {
    highlightAccordionItem(exp.id);
  }

  function onTimelineLeave() {
    highlightAccordionItem(null);
  }

  /* ---------- form helpers ---------- */

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* ---------- color (hex) ---------- */

  function normalizeHex(value) {
    // returns "#rrggbb" or null if not a valid hex color
    var v = (value || "").trim().toLowerCase();
    if (v.charAt(0) !== "#") v = "#" + v;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }

  function setColor(value) {
    fColor.value = value;
    var hex = normalizeHex(value);
    colorSwatch.style.background = hex || "transparent";
  }

  fColor.addEventListener("input", function () {
    var hex = normalizeHex(fColor.value);
    colorSwatch.style.background = hex || "transparent";
  });

  /* ---------- url ---------- */

  function normalizeUrl(value) {
    // "" for empty, null for invalid, otherwise a safe absolute http(s)/mailto url
    var v = (value || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v) && !/^mailto:/i.test(v)) v = "https://" + v;
    try {
      var u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "mailto:") {
        return null;
      }
      return u.href;
    } catch (e) {
      return null;
    }
  }

  /* ---------- rich text (details) ---------- */

  var ALLOWED_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1,
    UL: 1, OL: 1, LI: 1, BR: 1, P: 1, DIV: 1, SPAN: 1
  };

  function sanitizeHtml(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";

    function walk(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 1) {
          if (child.tagName === "SCRIPT" || child.tagName === "STYLE") {
            node.removeChild(child);
            return;
          }
          if (!ALLOWED_TAGS[child.tagName]) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            return;
          }
          Array.prototype.slice.call(child.attributes).forEach(function (attr) {
            if (child.tagName === "A" && attr.name.toLowerCase() === "href") {
              var safe = normalizeUrl(attr.value);
              if (safe) {
                child.setAttribute("href", safe);
                child.setAttribute("target", "_blank");
                child.setAttribute("rel", "noopener noreferrer");
              } else {
                child.removeAttribute("href");
              }
            } else {
              child.removeAttribute(attr.name);
            }
          });
          walk(child);
        } else if (child.nodeType === 8) {
          node.removeChild(child);
        }
      });
    }

    walk(tpl.content);
    return tpl.innerHTML;
  }

  function getDetailsHtml() {
    if (!fDetails.textContent.replace(/\u00a0/g, " ").trim()) return "";
    return sanitizeHtml(fDetails.innerHTML);
  }

  // Toolbar: keep the editor's selection when a button is pressed.
  rteToolbar.addEventListener("mousedown", function (ev) {
    if (ev.target.closest(".rte-btn")) ev.preventDefault();
  });

  rteToolbar.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".rte-btn");
    if (!btn) return;
    var cmd = btn.getAttribute("data-cmd");
    fDetails.focus();
    if (cmd === "createLink") {
      var input = window.prompt("Link URL:", "https://");
      if (!input) return;
      var url = normalizeUrl(input);
      if (!url) {
        setStatus("Invalid link URL.");
        return;
      }
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
  });

  function parseMonthInput(value) {
    // "YYYY-MM"
    var parts = value.split("-");
    return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
  }

  function parseDateInput(value) {
    // "YYYY-MM-DD" — day kept so one-day highlights sit on the right spot
    var parts = value.split("-");
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10)
    };
  }

  function updateFieldVisibility() {
    var isHighlight = fHighlight.checked;
    var isOngoing = fOngoing.checked;

    if (isHighlight) {
      fStart.type = "date";
      endWrap.style.display = "none";
      ongoingWrap.style.display = "none";
      fEnd.required = false;
      fOngoing.checked = false;
    } else {
      fStart.type = "month";
      endWrap.style.display = "";
      ongoingWrap.style.display = "";
    }

    if (!isHighlight && isOngoing) {
      fEnd.disabled = true;
      fEnd.required = false;
      fEnd.value = "";
    } else if (!isHighlight) {
      fEnd.disabled = false;
      fEnd.required = true;
    }
  }

  fHighlight.addEventListener("change", updateFieldVisibility);
  fOngoing.addEventListener("change", updateFieldVisibility);
  updateFieldVisibility();

  function setStatus(message) {
    statusEl.textContent = message;
    if (message) {
      window.setTimeout(function () {
        if (statusEl.textContent === message) statusEl.textContent = "";
      }, 2500);
    }
  }

  /* ---------- icon staging ---------- */

  function setIcon(dataUrl) {
    currentIcon = dataUrl || "";
    if (currentIcon) {
      iconPreview.src = currentIcon;
      iconPreview.hidden = false;
      iconClear.hidden = false;
      iconPickLabel.textContent = "Replace…";
    } else {
      iconPreview.removeAttribute("src");
      iconPreview.hidden = true;
      iconClear.hidden = true;
      iconPickLabel.textContent = "Choose…";
    }
  }

  // Most-used color in the image, ignoring transparent and near-white
  // (background) pixels. Colors are bucketed so slight gradients count
  // as one color; the bucket's average is returned as hex.
  function extractDominantColor(dataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        var SIZE = 64; // downsample: plenty for a dominant-color estimate
        var canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        var data = ctx.getImageData(0, 0, SIZE, SIZE).data;

        var buckets = {};
        for (var i = 0; i < data.length; i += 4) {
          var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;               // transparent
          if (r > 240 && g > 240 && b > 240) continue; // near-white background
          var key = (r >> 5) + "," + (g >> 5) + "," + (b >> 5); // 32-step buckets
          var bucket = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
          bucket.n++;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
        }

        var best = null;
        for (var k in buckets) {
          if (!best || buckets[k].n > best.n) best = buckets[k];
        }
        if (!best) return cb(null); // fully transparent/white image

        var toHex = function (v) {
          var h = Math.round(v).toString(16);
          return h.length === 1 ? "0" + h : h;
        };
        cb("#" + toHex(best.r / best.n) + toHex(best.g / best.n) + toHex(best.b / best.n));
      } catch (e) {
        cb(null); // canvas unavailable or image undecodable
      }
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  }

  fIcon.addEventListener("change", function () {
    var file = fIcon.files && fIcon.files[0];
    if (!file) return;
    if (file.size > MAX_ICON_BYTES) {
      setStatus("Icon too large (max 800 KB). Use a smaller image.");
      fIcon.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      setIcon(reader.result);
      // Suggest the icon's dominant color as the default — still editable.
      extractDominantColor(reader.result, function (hex) {
        if (hex) {
          setColor(hex);
          setStatus("Color set from icon — edit the hex to override.");
        }
      });
    };
    reader.onerror = function () {
      setStatus("Couldn't read that image.");
    };
    reader.readAsDataURL(file);
  });

  iconClear.addEventListener("click", function () {
    fIcon.value = "";
    setIcon("");
  });

  function resizeImage(dataUrl, maxPx, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (w <= maxPx && h <= maxPx) return cb(dataUrl);
      var scale = Math.min(maxPx / w, maxPx / h);
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      cb(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  }

  function renderPhotosPreview() {
    photosPreview.innerHTML = "";
    stagedPhotos.forEach(function (url, i) {
      var wrap = document.createElement("span");
      wrap.className = "photo-thumb-wrap";
      var thumb = document.createElement("img");
      thumb.className = "photo-thumb";
      thumb.src = url;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "photo-thumb-rm";
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        stagedPhotos.splice(i, 1);
        renderPhotosPreview();
      });
      wrap.appendChild(thumb);
      wrap.appendChild(rm);
      photosPreview.appendChild(wrap);
    });
  }

  function renderDocsPreview() {
    docsPreview.innerHTML = "";
    stagedDocs.forEach(function (doc, i) {
      var wrap = document.createElement("span");
      wrap.className = "doc-chip";
      wrap.textContent = doc.name;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "doc-chip-rm";
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        stagedDocs.splice(i, 1);
        renderDocsPreview();
      });
      wrap.appendChild(rm);
      docsPreview.appendChild(wrap);
    });
  }

  fPhotos.addEventListener("change", function () {
    var files = fPhotos.files;
    if (!files || !files.length) return;
    var pending = files.length;
    Array.prototype.forEach.call(files, function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        resizeImage(reader.result, MAX_PHOTO_PX, function (resized) {
          if (resized) stagedPhotos.push(resized);
          pending--;
          if (pending <= 0) renderPhotosPreview();
        });
      };
      reader.readAsDataURL(file);
    });
    fPhotos.value = "";
  });

  fDocs.addEventListener("change", function () {
    var files = fDocs.files;
    if (!files || !files.length) return;
    Array.prototype.forEach.call(files, function (file) {
      if (file.size > MAX_DOC_BYTES) {
        setStatus(file.name + " is too large (max 2 MB).");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        stagedDocs.push({ name: file.name, dataUrl: reader.result });
        renderDocsPreview();
      };
      reader.readAsDataURL(file);
    });
    fDocs.value = "";
  });

  function clearForm() {
    form.reset();
    setColor("#5b5b5b");
    fUrl.value = "";
    fRelated.value = "";
    fTags.value = "";
    fLane.value = "";
    fSection.value = "";
    fDetails.innerHTML = "";
    fIcon.value = "";
    setIcon("");
    stagedPhotos = [];
    renderPhotosPreview();
    stagedDocs = [];
    renderDocsPreview();
    updateFieldVisibility();
  }

  /* ---------- edit mode ---------- */

  function startEdit(exp) {
    editingId = exp.id;

    fHighlight.checked = !!exp.highlight;
    fOngoing.checked = !!exp.ongoing;
    updateFieldVisibility();

    fTitle.value = exp.title || "";
    fRole.value = exp.role || "";
    if (exp.highlight) {
      fStart.value = exp.start.year + "-" + pad2(exp.start.month) + "-" + pad2(exp.start.day || 1);
    } else {
      fStart.value = exp.start.year + "-" + pad2(exp.start.month);
    }
    fEnd.value = (!exp.highlight && !exp.ongoing && exp.end)
      ? exp.end.year + "-" + pad2(exp.end.month)
      : "";
    setColor(exp.color || "#5b5b5b");
    fNote.value = exp.note || "";
    fUrl.value = exp.url || "";
    refreshRelatedOptions();       // rebuild options excluding this entry
    fRelated.value = exp.relatedTo || "";
    if (fRelated.value !== (exp.relatedTo || "")) fRelated.value = "";
    fTags.value = (exp.tags || []).join(", ");
    fSection.value = exp.section || "";
    fLane.value = (typeof exp.lane === "number" && exp.lane >= 0) ? (exp.lane + 1) : "";
    fDetails.innerHTML = exp.details ? sanitizeHtml(exp.details) : "";
    fIcon.value = "";
    setIcon(exp.icon || "");

    stagedPhotos = (exp.photos || []).slice();
    renderPhotosPreview();
    stagedDocs = (exp.docs || []).slice();
    renderDocsPreview();

    addBtn.textContent = "Save changes";
    cancelBtn.hidden = false;

    renderAll();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    fTitle.focus();
  }

  function exitEditMode() {
    editingId = null;
    addBtn.textContent = "Add experience";
    cancelBtn.hidden = true;
    clearForm();
  }

  cancelBtn.addEventListener("click", function () {
    exitEditMode();
    renderAll();
  });

  /* ---------- submit ---------- */

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();

    var title = fTitle.value.trim();
    var isHighlight = fHighlight.checked;
    var isOngoing = fOngoing.checked;

    if (!title) {
      setStatus("Title is required.");
      return;
    }
    if (!fStart.value) {
      setStatus(isHighlight ? "Date is required." : "Start date is required.");
      return;
    }
    if (!isHighlight && !isOngoing && !fEnd.value) {
      setStatus("End date is required (or mark as ongoing).");
      return;
    }

    var start = isHighlight ? parseDateInput(fStart.value) : parseMonthInput(fStart.value);
    var end = (!isHighlight && !isOngoing) ? parseMonthInput(fEnd.value) : null;

    if (end && (end.year * 12 + end.month) < (start.year * 12 + start.month)) {
      setStatus("End date is before start date.");
      return;
    }

    var color = normalizeHex(fColor.value);
    if (!color) {
      setStatus("Color must be a hex value like #4f7869.");
      return;
    }
    setColor(color);

    var url = normalizeUrl(fUrl.value);
    if (url === null) {
      setStatus("URL is not valid.");
      return;
    }

    // Lane is 1-based in the form (blank = auto); stored 0-based, or null for auto.
    var laneVal = fLane.value.trim();
    var lane = null;
    if (laneVal !== "") {
      var parsedLane = parseInt(laneVal, 10);
      if (!isNaN(parsedLane)) lane = Math.max(0, parsedLane - 1);
    }

    var experience = {
      id: editingId || ("u" + Date.now() + Math.random().toString(36).slice(2, 7)),
      title: title,
      role: fRole.value.trim(),
      start: start,
      end: end,
      ongoing: !isHighlight && isOngoing,
      highlight: isHighlight,
      color: color,
      note: fNote.value.trim(),
      url: url,
      relatedTo: fRelated.value || "",
      tags: parseTags(fTags.value),
      section: fSection.value || "",
      lane: lane,
      details: getDetailsHtml(),
      icon: currentIcon,
      photos: stagedPhotos.slice(),
      docs: stagedDocs.slice()
    };

    if (editingId) {
      TimelineData.updateExperience(experience);
      exitEditMode();
      setStatus("Saved.");
    } else {
      TimelineData.addExperience(experience);
      clearForm();
      setStatus("Added.");
      fTitle.focus();
    }

    renderAll();
  });

  /* ---------- export / reset ---------- */

  exportBtn.addEventListener("click", function () {
    var blob = new Blob([TimelineData.exportJSON()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "timeline-experiences.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Exported.");
  });

  function updateRestoreButton() {
    var info = TimelineData.backupInfo();
    if (info) {
      restoreBtn.hidden = false;
      restoreBtn.textContent = "Restore backup (" + info.count + ")";
      restoreBtn.title = info.savedAt
        ? "Snapshot taken " + new Date(info.savedAt).toLocaleString()
        : "";
    } else {
      restoreBtn.hidden = true;
    }
  }

  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        setStatus("That file isn't valid JSON.");
        importFile.value = "";
        return;
      }
      // A backup is auto-taken inside importExperiences, so this is undoable.
      var n = TimelineData.importExperiences(parsed);
      importFile.value = "";
      if (n < 0) {
        setStatus("No valid experiences found in that file.");
        return;
      }
      exitEditMode();
      openId = null;
      renderAll();
      updateRestoreButton();
      setStatus("Imported " + n + " experience" + (n === 1 ? "" : "s") + ".");
    };
    reader.onerror = function () {
      setStatus("Couldn't read that file.");
      importFile.value = "";
    };
    reader.readAsText(file);
  });

  restoreBtn.addEventListener("click", function () {
    var info = TimelineData.backupInfo();
    if (!info) return;
    if (!window.confirm("Restore the backup of " + info.count
        + " experiences? Your current data is snapshotted first, so this is undoable too.")) {
      return;
    }
    if (TimelineData.restoreBackup()) {
      exitEditMode();
      openId = null;
      renderAll();
      updateRestoreButton();
      setStatus("Backup restored.");
    }
  });

  resetBtn.addEventListener("click", function () {
    if (!window.confirm("Discard all edits and restore the built-in entries?\n\n"
        + "Your current data is backed up first — use “Restore backup” to undo.")) {
      return;
    }
    TimelineData.resetToDefaults();
    exitEditMode();
    openId = null;
    renderAll();
    updateRestoreButton();
    setStatus("Reset to defaults — backup saved, use Restore to undo.");
  });

  setColor(fColor.value);
  TimelineData.onReady(function () {
    renderAll();
    updateRestoreButton();
  });
})();
