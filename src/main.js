import './style.css';
import eventsData from './events.json';
import {
  escapeHtml,
  GAME_META,
  isAvailable,
  isFeaturedEvent,
  normalizeBookmarks,
  projectEventForDisplay,
  safeExternalUrl,
  safeScreenshotUrl,
  statusMeta
} from './event-domain.js';
import {
  mergeEventState,
  parsePersistedEventState,
  serializeEventState
} from './event-storage.js';

const EVENT_STORAGE_KEY = 'hoyo_archive_custom_events';
const LEGACY_EVENT_STORAGE_BACKUP_KEY = `${EVENT_STORAGE_KEY}_legacy_backup`;
const BOOKMARK_STORAGE_KEY = 'hoyo_archive_bookmarks';
const gameCovers = Object.fromEntries(
  Object.entries(GAME_META).map(([key, meta]) => [key, meta.cover])
);

const retiredEventIds = new Set(['sr-34', 'sr-35', 'sr-36', 'sr-37', 'zzz-10']);

function loadEvents() {
  let raw = null;
  try {
    raw = localStorage.getItem(EVENT_STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to read local event edits:', error.message);
  }

  const parsed = parsePersistedEventState(raw, eventsData);
  if (parsed.error) {
    console.warn(`Ignoring invalid local event edits: ${parsed.error}`);
  }
  if (parsed.migrated) {
    try {
      if (!localStorage.getItem(LEGACY_EVENT_STORAGE_BACKUP_KEY)) {
        localStorage.setItem(LEGACY_EVENT_STORAGE_BACKUP_KEY, raw);
      }
      localStorage.setItem(EVENT_STORAGE_KEY, serializeEventState(parsed.overlay));
    } catch (error) {
      console.warn('Unable to persist migrated local event edits:', error.message);
    }
  }

  return mergeEventState(eventsData, parsed.overlay)
    .map(event => projectEventForDisplay(event))
    .filter(event => !retiredEventIds.has(event.id));
}

function loadBookmarks() {
  try {
    return normalizeBookmarks(JSON.parse(localStorage.getItem(BOOKMARK_STORAGE_KEY) || '[]'));
  } catch (error) {
    console.warn('Ignoring invalid bookmark storage:', error.message);
    return [];
  }
}

// Application State
const state = {
  events: loadEvents(),
  bookmarks: loadBookmarks(),
  currentTab: 'home',      // home | library | timeline | reports | reflow | expired | about
  currentSubtab: 'all',    // all | latest | ending | popular | favorites (Only inside Home/Library)
  filters: {
    game: 'all',           // all | ys | sr | zzz | bh3
    type: 'all',           // all | 年度报告 | 回归活动 | 版本前瞻 | 小游戏 | 资料站 | 预约/预抽卡 | 联动活动 | 其他活动
    status: 'all'          // all | 可访问 | 已失效 | 需登录 | 已结束
  },
  searchQuery: '',
  viewLayout: 'grid',      // grid | list
  sortKey: 'date-desc',    // date-desc | date-asc | title-asc | status-asc
  selectedEvent: null
};

// DOM Elements
let elGameFilters, elTypeFilters, elStatusFilters;
let elEventsContainer, elTimelineContainer;
let elStatTotal, elStatAvailable, elStatExpired;
let elHeroStatTotal, elHeroStatAvailable, elHeroStatExpired;
let elCountYs, elCountSr, elCountZzz, elCountBh3;
let elSearchInput, elHeroSearchInput;
let elViewGridBtn, elViewListBtn;
let elDetailModal, elModalHeroImg, elModalTitle, elModalDate, elModalVersion, elModalType, elModalDesc, elModalTags, elModalPrimaryLink, elModalFavoriteBtn, elModalGameBadge, elModalStatusBadge;
let elGameZoneHeader, elGameZoneLogo, elGameZoneTitle, elGameZoneDesc, elZoneStatTotal, elZoneStatAvailable, elZoneStatExpired, elBackToHomeBtn;
let elMobileNavToggle, elMobileFilterBtn, elSidebarCloseBtn, elDrawerOverlay, elSidebarPanel, elNavMenu;


// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  bindEvents();
  updateStats();
  renderSidebarFilters();
  renderRecentlyUpdated();
  applyTabChange(state.currentTab);
});

// Cache DOM Elements
function initDOM() {
  elGameFilters = document.getElementById('gameFilters');
  elTypeFilters = document.getElementById('typeFilters');
  elStatusFilters = document.getElementById('statusFilters');
  
  elEventsContainer = document.getElementById('eventsContainer');
  elTimelineContainer = document.getElementById('timelineContainer');
  
  elStatTotal = document.getElementById('statTotal');
  elStatAvailable = document.getElementById('statAvailable');
  elStatExpired = document.getElementById('statExpired');
  
  elHeroStatTotal = document.getElementById('heroStatTotal');
  elHeroStatAvailable = document.getElementById('heroStatAvailable');
  elHeroStatExpired = document.getElementById('heroStatExpired');
  
  elCountYs = document.getElementById('countYs');
  elCountSr = document.getElementById('countSr');
  elCountZzz = document.getElementById('countZzz');
  elCountBh3 = document.getElementById('countBh3');
  
  elHeroSearchInput = document.getElementById('heroSearchInput');
  elSearchInput = document.getElementById('heroSearchInput'); // Syncing
  
  elViewGridBtn = document.getElementById('viewGrid');
  elViewListBtn = document.getElementById('viewList');
  
  // Modal Elements
  elDetailModal = document.getElementById('detailModal');
  elModalHeroImg = document.getElementById('modalHeroImg');
  elModalTitle = document.getElementById('modalTitle');
  elModalDate = document.getElementById('modalDate');
  elModalVersion = document.getElementById('modalVersion');
  elModalType = document.getElementById('modalType');
  elModalDesc = document.getElementById('modalDesc');
  elModalTags = document.getElementById('modalTags');
  elModalPrimaryLink = document.getElementById('modalPrimaryLink');
  elModalFavoriteBtn = document.getElementById('modalFavoriteBtn');
  elModalGameBadge = document.getElementById('modalGameBadge');
  elModalStatusBadge = document.getElementById('modalStatusBadge');
  
  elGameZoneHeader = document.getElementById('gameZoneHeader');
  elGameZoneLogo = document.getElementById('gameZoneLogo');
  elGameZoneTitle = document.getElementById('gameZoneTitle');
  elGameZoneDesc = document.getElementById('gameZoneDesc');
  elZoneStatTotal = document.getElementById('zoneStatTotal');
  elZoneStatAvailable = document.getElementById('zoneStatAvailable');
  elZoneStatExpired = document.getElementById('zoneStatExpired');
  elBackToHomeBtn = document.getElementById('backToHomeBtn');
  
  elMobileNavToggle = document.getElementById('mobileNavToggle');
  elMobileFilterBtn = document.getElementById('mobileFilterBtn');
  elSidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  elDrawerOverlay = document.getElementById('drawerOverlay');
  elSidebarPanel = document.querySelector('.sidebar-panel');
  elNavMenu = document.querySelector('.header-bar nav');
}

// Bind event listeners
function bindEvents() {
  // Navigation tabs
  document.querySelectorAll('.nav-item').forEach(navLink => {
    navLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
      navLink.classList.add('active');
      const tabName = navLink.getAttribute('data-tab');
      applyTabChange(tabName);

      // Close mobile navigation drawer
      if (elNavMenu) elNavMenu.classList.remove('open');
      if (elDrawerOverlay) elDrawerOverlay.classList.remove('active');
      if (elMobileNavToggle) {
        const icon = elMobileNavToggle.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      }
    });
  });

  // Main Category Sub-tabs
  document.querySelectorAll('.control-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.control-tab').forEach(btn => btn.classList.remove('active'));
      tabBtn.classList.add('active');
      state.currentSubtab = tabBtn.getAttribute('data-subtab');
      renderEvents();
    });
  });

  // Game card portals
  document.querySelectorAll('.portal-card').forEach(card => {
    card.addEventListener('click', () => {
      const gameKey = card.getAttribute('data-game');
      setGameFilter(gameKey);
      scrollToEvents();
    });
  });

  // View switches
  elViewGridBtn.addEventListener('click', () => {
    elViewGridBtn.classList.add('active');
    elViewListBtn.classList.remove('active');
    state.viewLayout = 'grid';
    renderEvents();
  });

  elViewListBtn.addEventListener('click', () => {
    elViewListBtn.classList.add('active');
    elViewGridBtn.classList.remove('active');
    state.viewLayout = 'list';
    renderEvents();
  });

  // Custom Select Dropdown logic
  const dropdown = document.getElementById('sortSelectDropdown');
  const trigger = document.getElementById('sortSelectTrigger');
  const selectedText = document.getElementById('sortSelectedText');
  const options = document.getElementById('sortSelectOptions');

  if (trigger && options) {
    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close when clicking options or clicking outside
    options.querySelectorAll('.select-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Remove active class from other options
        options.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
        
        // Add active class
        opt.classList.add('active');
        
        // Update trigger text
        selectedText.textContent = opt.textContent;
        
        // Update state
        state.sortKey = opt.getAttribute('data-value');
        
        // Close dropdown
        dropdown.classList.remove('open');
        
        // Render events
        renderEvents();
      });
    });

    // Close when clicking outside the dropdown
    document.addEventListener('click', (e) => {
      if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }

  // Hero Search box
  elHeroSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderEvents();
  });

  document.getElementById('heroSearchBtn').addEventListener('click', () => {
    state.searchQuery = elHeroSearchInput.value.trim().toLowerCase();
    renderEvents();
  });

  // Header quick search button
  const elHeaderSearchBtn = document.getElementById('headerSearchBtn');
  if (elHeaderSearchBtn) {
    elHeaderSearchBtn.addEventListener('click', () => {
      setTab('home');
      elHeroSearchInput.focus();
      elHeroSearchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Handle header search button visibility based on scroll
  const elMainContent = document.getElementById('mainContent');
  if (elMainContent) {
    elMainContent.addEventListener('scroll', updateHeaderSearchVisibility);
  }

  // Back to Home button click inside Game Zone
  if (elBackToHomeBtn) {
    elBackToHomeBtn.addEventListener('click', () => {
      setGameFilter('all');
      const elPaneHome = document.getElementById('paneHome');
      if (elPaneHome) {
        elPaneHome.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Hot Tags click
  document.querySelectorAll('.hot-tag').forEach(tagEl => {
    tagEl.addEventListener('click', () => {
      const tagText = tagEl.textContent;
      elHeroSearchInput.value = tagText;
      state.searchQuery = tagText.toLowerCase();
      renderEvents();
      scrollToEvents();
    });
  });

  // Modal actions
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  elDetailModal.addEventListener('click', (e) => {
    if (e.target === elDetailModal) closeModal();
  });

  // Modal Favorite toggle
  elModalFavoriteBtn.addEventListener('click', () => {
    if (!state.selectedEvent) return;
    if (!toggleBookmark(state.selectedEvent.id)) return;
    updateModalFavoriteButton();
    renderEvents(); // Update cards UI
  });



  // "Recent updates" list more button
  document.getElementById('recentMoreBtn').addEventListener('click', () => {
    setTab('library');
    // Set to latest subtab
    const latestTabBtn = document.querySelector('[data-subtab="latest"]');
    if (latestTabBtn) latestTabBtn.click();
    scrollToEvents();
  });

  // Mobile navigation drawer toggle
  if (elMobileNavToggle) {
    elMobileNavToggle.addEventListener('click', () => {
      const isOpen = elNavMenu.classList.toggle('open');
      elDrawerOverlay.classList.toggle('active', isOpen);
      const icon = elMobileNavToggle.querySelector('i');
      if (icon) {
        icon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
      }
      // Close sidebar if open
      if (elSidebarPanel) {
        elSidebarPanel.classList.remove('open');
      }
    });
  }

  // Mobile filters drawer toggle
  if (elMobileFilterBtn) {
    elMobileFilterBtn.addEventListener('click', () => {
      if (elSidebarPanel) elSidebarPanel.classList.add('open');
      if (elDrawerOverlay) elDrawerOverlay.classList.add('active');
      // Close nav menu if open
      if (elNavMenu) {
        elNavMenu.classList.remove('open');
        const icon = elMobileNavToggle.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      }
    });
  }

  // Mobile filters close button
  if (elSidebarCloseBtn) {
    elSidebarCloseBtn.addEventListener('click', () => {
      if (elSidebarPanel) elSidebarPanel.classList.remove('open');
      if (elDrawerOverlay) elDrawerOverlay.classList.remove('active');
    });
  }

  // Click overlay to close both drawers
  if (elDrawerOverlay) {
    elDrawerOverlay.addEventListener('click', () => {
      if (elSidebarPanel) elSidebarPanel.classList.remove('open');
      if (elNavMenu) elNavMenu.classList.remove('open');
      elDrawerOverlay.classList.remove('active');
      const icon = elMobileNavToggle.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-bars';
    });
  }
}

// Scroll to events grid view
function scrollToEvents() {
  const controlBar = document.querySelector('.control-bar');
  if (controlBar) {
    controlBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Set game filter specifically
function setGameFilter(gameKey) {
  state.filters.game = gameKey;
  // Update sidebar active classes
  document.querySelectorAll('#gameFilters .filter-btn').forEach(btn => {
    if (btn.getAttribute('data-value') === gameKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  renderEvents();
}

// Handle global tab change
function applyTabChange(tabName) {
  state.currentTab = tabName;
  
  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));
  
  // Reset layouts
  const elHeroWrapper = document.querySelector('.hero-wrapper');
  const elGamePortals = document.querySelector('.game-portals');
  const elControlBar = document.querySelector('.control-bar');
  const elGridContainer = document.querySelector('.event-grid-container');

  // Show corresponding panes & apply filter states
  if (tabName === 'home') {
    document.getElementById('paneHome').classList.remove('hidden');
    elHeroWrapper.classList.remove('hidden');
    elGamePortals.classList.remove('hidden');
    elControlBar.classList.remove('hidden');
    elGridContainer.classList.remove('hidden');
    
    // Reset filters
    resetAllFilters();
    state.currentSubtab = 'all';
    document.querySelectorAll('.control-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-subtab') === 'all');
    });
    renderEvents();
  } 
  else if (tabName === 'library') {
    document.getElementById('paneHome').classList.remove('hidden');
    elHeroWrapper.classList.add('hidden');
    elGamePortals.classList.add('hidden');
    elControlBar.classList.remove('hidden');
    elGridContainer.classList.remove('hidden');
    
    resetAllFilters();
    renderEvents();
  } 
  else if (tabName === 'timeline') {
    document.getElementById('paneTimeline').classList.remove('hidden');
    renderTimeline();
  } 
  else if (tabName === 'reports') {
    document.getElementById('paneHome').classList.remove('hidden');
    elHeroWrapper.classList.add('hidden');
    elGamePortals.classList.add('hidden');
    elControlBar.classList.remove('hidden');
    elGridContainer.classList.remove('hidden');
    
    resetAllFilters();
    state.filters.type = '年度报告';
    syncSidebarActiveFilters();
    renderEvents();
  } 
  else if (tabName === 'reflow') {
    document.getElementById('paneHome').classList.remove('hidden');
    elHeroWrapper.classList.add('hidden');
    elGamePortals.classList.add('hidden');
    elControlBar.classList.remove('hidden');
    elGridContainer.classList.remove('hidden');
    
    resetAllFilters();
    state.filters.type = '回归活动';
    syncSidebarActiveFilters();
    renderEvents();
  } 
  else if (tabName === 'expired') {
    document.getElementById('paneHome').classList.remove('hidden');
    elHeroWrapper.classList.add('hidden');
    elGamePortals.classList.add('hidden');
    elControlBar.classList.remove('hidden');
    elGridContainer.classList.remove('hidden');
    
    resetAllFilters();
    state.filters.status = '已失效';
    syncSidebarActiveFilters();
    renderEvents();
  } 
  else if (tabName === 'about') {
    document.getElementById('paneAbout').classList.remove('hidden');
  }
  
  updateHeaderSearchVisibility();
}

// Update visibility of the header quick search button based on scroll and active tab
function updateHeaderSearchVisibility() {
  const elHeaderSearchBtn = document.getElementById('headerSearchBtn');
  const elMainContent = document.getElementById('mainContent');
  if (!elHeaderSearchBtn) return;
  
  if (state.currentTab === 'home') {
    const scrollPos = elMainContent ? elMainContent.scrollTop : 0;
    if (scrollPos < 180) {
      elHeaderSearchBtn.style.opacity = '0';
      elHeaderSearchBtn.style.pointerEvents = 'none';
    } else {
      elHeaderSearchBtn.style.opacity = '1';
      elHeaderSearchBtn.style.pointerEvents = 'all';
    }
  } else {
    elHeaderSearchBtn.style.opacity = '1';
    elHeaderSearchBtn.style.pointerEvents = 'all';
  }
}

// Utility to change nav active state programmatically
function setTab(tabName) {
  const targetNav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (targetNav) {
    targetNav.click();
  }
}

// Reset filter state
function resetAllFilters() {
  state.filters.game = 'all';
  state.filters.type = 'all';
  state.filters.status = 'all';
  state.searchQuery = '';
  if (elHeroSearchInput) elHeroSearchInput.value = '';
  
  syncSidebarActiveFilters();
}

// Sync CSS classes on sidebar list
function syncSidebarActiveFilters() {
  document.querySelectorAll('#gameFilters .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-value') === state.filters.game);
  });
  document.querySelectorAll('#typeFilters .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-value') === state.filters.type);
  });
  document.querySelectorAll('#statusFilters .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-value') === state.filters.status);
  });
}

// Calculate and render stats in dashboard
function updateStats() {
  const total = state.events.length;
  const available = state.events.filter(isAvailable).length;
  const expired = state.events.filter(e => e.status === '已失效').length;
  
  elStatTotal.textContent = total;
  elStatAvailable.textContent = available;
  elStatExpired.textContent = expired;
  
  if (elHeroStatTotal) elHeroStatTotal.textContent = total;
  if (elHeroStatAvailable) elHeroStatAvailable.textContent = available;
  if (elHeroStatExpired) elHeroStatExpired.textContent = expired;
  
  // Render game counts as secondary archive metadata and keep whole-card labels descriptive.
  [
    { element: elCountYs, gameKey: 'ys', gameName: '原神' },
    { element: elCountSr, gameKey: 'sr', gameName: '星穹铁道' },
    { element: elCountZzz, gameKey: 'zzz', gameName: '绝区零' },
    { element: elCountBh3, gameKey: 'bh3', gameName: '崩坏3' }
  ].forEach(({ element, gameKey, gameName }) => {
    const count = state.events.filter(event => event.gameKey === gameKey).length;
    element.textContent = `${count} 项收录`;
    element.closest('.portal-card')?.setAttribute('aria-label', `进入${gameName}专区，收录${count}项活动`);
  });
}

// Dynamic Sidebar Filters with Badge counters
function renderSidebarFilters() {
  // 1. Games
  const games = [
    { label: '全部游戏', value: 'all', icon: 'fa-gamepad' },
    { label: '原神', value: 'ys', icon: 'fa-star' },
    { label: '星穹铁道', value: 'sr', icon: 'fa-train' },
    { label: '绝区零', value: 'zzz', icon: 'fa-bolt' },
    { label: '崩坏3', value: 'bh3', icon: 'fa-wand-magic-sparkles' }
  ];
  
  elGameFilters.innerHTML = games.map(g => {
    const count = g.value === 'all' ? state.events.length : state.events.filter(e => e.gameKey === g.value).length;
    const activeClass = g.value === state.filters.game ? 'active' : '';
    return `
      <li>
        <button class="filter-btn ${activeClass}" data-value="${g.value}">
          <span class="filter-btn-left">
            <i class="fa-solid ${g.icon}"></i>
            <span>${g.label}</span>
          </span>
          <span class="filter-count">${count}</span>
        </button>
      </li>
    `;
  }).join('');

  // 2. Types
  const types = [
    { label: '全部类型', value: 'all', icon: 'fa-border-all' },
    { label: '年度报告', value: '年度报告', icon: 'fa-chart-pie' },
    { label: '回归活动', value: '回归活动', icon: 'fa-arrows-spin' },
    { label: '版本前瞻', value: '版本前瞻', icon: 'fa-tower-broadcast' },
    { label: '小游戏', value: '小游戏', icon: 'fa-puzzle-piece' },
    { label: '资料站', value: '资料站', icon: 'fa-book' },
    { label: '预约/预抽卡', value: '预约/预抽卡', icon: 'fa-ticket' },
    { label: '联动活动', value: '联动活动', icon: 'fa-handshake' },
    { label: '其他活动', value: '其他活动', icon: 'fa-tags' }
  ];

  elTypeFilters.innerHTML = types.map(t => {
    const count = t.value === 'all' ? state.events.length : state.events.filter(e => e.type === t.value).length;
    const activeClass = t.value === state.filters.type ? 'active' : '';
    return `
      <li>
        <button class="filter-btn ${activeClass}" data-value="${t.value}">
          <span class="filter-btn-left">
            <i class="fa-solid ${t.icon}"></i>
            <span>${gTypeLabelShort(t.label)}</span>
          </span>
          <span class="filter-count">${count}</span>
        </button>
      </li>
    `;
  }).join('');

  // 3. Statuses
  const statuses = [
    { label: '全部状态', value: 'all', iconClass: '' },
    { label: '可访问', value: '可访问', iconClass: 'available' },
    { label: '已失效 (404)', value: '已失效', iconClass: 'expired' },
    { label: '需登录', value: '需登录', iconClass: 'login' },
    { label: '已结束', value: '已结束', iconClass: 'ended' }
  ];

  elStatusFilters.innerHTML = statuses.map(s => {
    const count = s.value === 'all' ? state.events.length : state.events.filter(e => e.status === s.value).length;
    const activeClass = s.value === state.filters.status ? 'active' : '';
    const lightDot = s.iconClass ? `<span class="status-indicator ${s.iconClass}"></span>` : '<i class="fa-solid fa-circle-nodes"></i>';
    return `
      <li>
        <button class="filter-btn ${activeClass}" data-value="${s.value}">
          <span class="filter-btn-left">
            ${lightDot}
            <span>${s.label}</span>
          </span>
          <span class="filter-count">${count}</span>
        </button>
      </li>
    `;
  }).join('');

  // Bind click handlers to newly created sidebar buttons
  document.querySelectorAll('.sidebar-panel .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const parentList = btn.closest('.filter-list');
      const val = btn.getAttribute('data-value');
      
      // Clear active states in this group
      parentList.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (parentList.id === 'gameFilters') {
        state.filters.game = val;
      } else if (parentList.id === 'typeFilters') {
        state.filters.type = val;
      } else if (parentList.id === 'statusFilters') {
        state.filters.status = val;
      }
      
      renderEvents();
      
      // Close mobile filters drawer after selection
      if (window.innerWidth <= 1024) {
        if (elSidebarPanel) elSidebarPanel.classList.remove('open');
        if (elDrawerOverlay) elDrawerOverlay.classList.remove('active');
      }
    });
  });
}

function gTypeLabelShort(label) {
  return label;
}

function formatEventDate(event, compact = false) {
  if (event.dateType === 'announcement') {
    return `${compact ? '公告 ' : '公告于 '}${event.date}`;
  }
  return event.date;
}

// Render recently updated panel in Home
function renderRecentlyUpdated() {
  const recentList = [...state.events]
    .sort((a, b) => new Date(b.date.replace(/\./g, '/')) - new Date(a.date.replace(/\./g, '/')))
    .slice(0, 5);

  const listEl = document.getElementById('recentlyUpdatedList');
  listEl.innerHTML = recentList.map(e => {
    return `
      <li class="update-item" data-id="${escapeHtml(e.id)}">
        <div class="update-item-left">
          <span class="update-game-badge ${escapeHtml(e.gameKey)}"></span>
          <span class="update-name" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</span>
        </div>
        <div class="update-info">
          <span>${escapeHtml(e.game)}</span>
          <span>${escapeHtml(formatEventDate(e, true))}</span>
        </div>
      </li>
    `;
  }).join('');

  // Bind click events
  listEl.querySelectorAll('.update-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      const eventObj = state.events.find(x => x.id === id);
      if (eventObj) openDetailModal(eventObj);
    });
  });
}

// Filter and Sort the datasets
function getFilteredEvents() {
  let list = [...state.events];

  // 1. Sidebar Game Filter
  if (state.filters.game !== 'all') {
    list = list.filter(e => e.gameKey === state.filters.game);
  }

  // 2. Sidebar Type Filter
  if (state.filters.type !== 'all') {
    list = list.filter(e => e.type === state.filters.type);
  }

  // 3. Sidebar Status Filter
  if (state.filters.status !== 'all') {
    list = list.filter(e => e.status === state.filters.status);
  }

  // 4. Subtabs (Horizontal control bar)
  if (state.currentSubtab === 'latest') {
    // Top 12 latest events
    list = list
      .sort((a, b) => new Date(b.date.replace(/\./g, '/')) - new Date(a.date.replace(/\./g, '/')))
      .slice(0, 12);
  } 
  else if (state.currentSubtab === 'ending') {
    list = list.filter(e => e.status === '已结束' || e.status === '已失效');
  } 
  else if (state.currentSubtab === 'popular') {
    list = list.filter(isFeaturedEvent);
  } 
  else if (state.currentSubtab === 'favorites') {
    list = list.filter(e => state.bookmarks.includes(e.id));
  }

  // 5. Text Search query
  if (state.searchQuery) {
    list = list.filter(e => 
      e.title.toLowerCase().includes(state.searchQuery) ||
      e.game.toLowerCase().includes(state.searchQuery) ||
      (e.version && e.version.toLowerCase().includes(state.searchQuery)) ||
      e.type.toLowerCase().includes(state.searchQuery) ||
      e.description.toLowerCase().includes(state.searchQuery) ||
      e.tags.some(tag => tag.toLowerCase().includes(state.searchQuery))
    );
  }

  // 6. Sorting
  list.sort((a, b) => {
    if (state.sortKey === 'date-desc') {
      return new Date(b.date.replace(/\./g, '/')) - new Date(a.date.replace(/\./g, '/'));
    } 
    else if (state.sortKey === 'date-asc') {
      return new Date(a.date.replace(/\./g, '/')) - new Date(b.date.replace(/\./g, '/'));
    } 
    else if (state.sortKey === 'title-asc') {
      return a.title.localeCompare(b.title, 'zh');
    } 
    else if (state.sortKey === 'status-asc') {
      return a.status.localeCompare(b.status, 'zh');
    }
    return 0;
  });

  return list;
}

// Render events in Grid or List layout
function renderEvents() {
  // Sync page headers and game zone visibility
  const elHeroWrapper = document.querySelector('.hero-wrapper');
  const elGamePortals = document.querySelector('.game-portals');
  
  if (state.currentTab === 'home') {
    if (state.filters.game === 'all') {
      if (elHeroWrapper) elHeroWrapper.classList.remove('hidden');
      if (elGamePortals) elGamePortals.classList.remove('hidden');
      if (elGameZoneHeader) elGameZoneHeader.classList.add('hidden');
    } else {
      if (elHeroWrapper) elHeroWrapper.classList.add('hidden');
      if (elGamePortals) elGamePortals.classList.add('hidden');
      if (elGameZoneHeader) {
        elGameZoneHeader.classList.remove('hidden');
        elGameZoneHeader.setAttribute('data-zone', state.filters.game);
        
        // Update Game Zone Details
        const gameKey = state.filters.game;
        const gameMeta = GAME_META[gameKey] || GAME_META.all;
        
        if (elGameZoneLogo) elGameZoneLogo.src = gameMeta.cover;
        if (elGameZoneTitle) elGameZoneTitle.textContent = gameMeta.title;
        if (elGameZoneDesc) elGameZoneDesc.textContent = gameMeta.description;
        
        // Calculate stats for this game
        const total = state.events.filter(e => e.gameKey === gameKey).length;
        const available = state.events.filter(e => e.gameKey === gameKey && isAvailable(e)).length;
        const expired = state.events.filter(e => e.gameKey === gameKey && e.status === '已失效').length;
        
        if (elZoneStatTotal) elZoneStatTotal.textContent = total;
        if (elZoneStatAvailable) elZoneStatAvailable.textContent = available;
        if (elZoneStatExpired) elZoneStatExpired.textContent = expired;
      }
    }
  } else {
    // Other tabs (library, timeline, etc.)
    if (elHeroWrapper) elHeroWrapper.classList.add('hidden');
    if (elGamePortals) elGamePortals.classList.add('hidden');
    if (elGameZoneHeader) elGameZoneHeader.classList.add('hidden');
  }

  const filtered = getFilteredEvents();
  
  if (filtered.length === 0) {
    elEventsContainer.className = 'empty-state-wrapper';
    elEventsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <h4>未找到符合条件的档案活动</h4>
        <p style="font-size: 12px; margin-top: 4px;">请尝试清除筛选条件或更换搜索词</p>
      </div>
    `;
    return;
  }

  if (state.viewLayout === 'grid') {
    elEventsContainer.className = 'event-grid';
    elEventsContainer.innerHTML = filtered.map(e => {
      const isBookmarked = state.bookmarks.includes(e.id);
      const gameCover = gameCovers[e.gameKey] || gameCovers.all;
      const status = statusMeta(e.status);
      const imageSrc = e.status === '已失效'
        ? gameCover
        : (safeScreenshotUrl(e.id) || gameCover);
      return `
        <div class="event-card" data-id="${escapeHtml(e.id)}">
          <div class="card-img-wrapper">
            <span class="status-badge ${status.className}">
              <i class="fa-solid ${status.icon}"></i>${escapeHtml(e.status)}
            </span>
            <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" data-id="${escapeHtml(e.id)}" title="${isBookmarked ? '取消收藏' : '加入收藏'}">
              <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-star"></i>
            </button>
            <img class="card-img" data-event-image data-game-key="${escapeHtml(e.gameKey)}" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(e.title)}" loading="lazy" />
          </div>
          <div class="event-details">
            <div class="event-info-top">
              <div class="event-meta-header">
                <span class="event-game-name">${escapeHtml(e.game)}</span>
                <span>&middot;</span>
                <span class="event-version-badge ${escapeHtml(e.gameKey)}">${escapeHtml(e.version || '通用')}</span>
                <span>&middot;</span>
                <span>${escapeHtml(e.type)}</span>
              </div>
              <h3 class="event-title-h3" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</h3>
            </div>
            
            <div class="event-tags">
              ${e.tags.slice(0, 3).map(t => `<span class="event-tag-badge">${escapeHtml(t)}</span>`).join('')}
            </div>
            
            <div class="event-date-row">
              <span>${escapeHtml(formatEventDate(e))}</span>
              <span style="color: var(--primary); font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                查看详情 <i class="fa-solid fa-angle-right" style="font-size: 10px;"></i>
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } 
  else {
    elEventsContainer.className = 'event-list';
    elEventsContainer.innerHTML = `
      <div class="event-list-header">
        <div>活动名称</div>
        <div>所属游戏</div>
        <div>关联版本</div>
        <div>活动类型</div>
        <div>相关日期</div>
        <div>访问状态</div>
        <div class="list-favorite-header">收藏</div>
      </div>
      ${filtered.map(e => {
        const isBookmarked = state.bookmarks.includes(e.id);
        const gameCover = gameCovers[e.gameKey] || gameCovers.all;
        const status = statusMeta(e.status);
        const imageSrc = e.status === '已失效'
          ? gameCover
          : (safeScreenshotUrl(e.id) || gameCover);
        return `
          <div class="event-list-row" data-id="${escapeHtml(e.id)}">
            <div class="list-title-cell">
              <img class="list-img-thumbnail" data-event-image data-game-key="${escapeHtml(e.gameKey)}" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(e.title)}" loading="lazy" />
              <span class="list-title-text" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</span>
            </div>
            <div class="list-game-cell">${escapeHtml(e.game)}</div>
            <div class="list-version-cell">
              <span class="event-version-badge ${escapeHtml(e.gameKey)}">${escapeHtml(e.version || '通用')}</span>
            </div>
            <div class="list-type-cell">${escapeHtml(e.type)}</div>
            <div class="list-date-cell">${escapeHtml(formatEventDate(e))}</div>
            <div class="list-status-cell">
              <span class="list-status-badge ${status.className}">${escapeHtml(e.status)}</span>
            </div>
            <div class="list-action-cell">
              <button class="bookmark-btn list-bookmark-btn ${isBookmarked ? 'active' : ''}" data-id="${escapeHtml(e.id)}" title="${isBookmarked ? '取消收藏' : '加入收藏'}">
                <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-star"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  elEventsContainer.querySelectorAll('img[data-event-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.src = gameCovers[image.dataset.gameKey] || gameCovers.all;
    }, { once: true });
  });

  // Bind click handlers to cards and lists
  elEventsContainer.querySelectorAll('.event-card, .event-list-row').forEach(card => {
    card.addEventListener('click', (e) => {
      // Prevent modal opening when clicking the bookmark star button
      if (e.target.closest('.bookmark-btn')) return;

      const eventId = card.getAttribute('data-id');
      const eventObj = state.events.find(x => x.id === eventId);
      if (eventObj) {
        openDetailModal(eventObj);
      }
    });
  });

  // Bind click handlers to bookmark buttons
  elEventsContainer.querySelectorAll('.bookmark-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventId = btn.getAttribute('data-id');
      if (!toggleBookmark(eventId)) return;
      
      // Visual toggle
      const isBookmarked = state.bookmarks.includes(eventId);
      btn.classList.toggle('active', isBookmarked);
      const starIcon = btn.querySelector('i');
      starIcon.className = isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star';
      btn.setAttribute('title', isBookmarked ? '取消收藏' : '加入收藏');
      
      // If we are currently in favorites tab, re-render
      if (state.currentSubtab === 'favorites') {
        renderEvents();
      }
    });
  });
}

// Render Linear Timeline
function renderTimeline() {
  const sorted = [...state.events].sort((a, b) => new Date(b.date.replace(/\./g, '/')) - new Date(a.date.replace(/\./g, '/')));
  
  // Group by year
  const groups = {};
  sorted.forEach(e => {
    const year = e.date.split('.')[0] || '其他';
    if (!groups[year]) groups[year] = [];
    groups[year].push(e);
  });

  const years = Object.keys(groups).sort((a, b) => b - a);

  elTimelineContainer.innerHTML = years.map(year => {
    const yearEvents = groups[year];
    return `
      <div class="timeline-year-group">
        <div class="timeline-year-header">
          <div class="timeline-year-dot">${escapeHtml(year)}</div>
        </div>
        ${yearEvents.map(e => {
          return `
            <div class="timeline-item" data-id="${escapeHtml(e.id)}">
              <div class="timeline-item-left">
                <div class="timeline-item-dot"></div>
              </div>
              <div class="timeline-item-card">
                <div class="timeline-card-left">
                  <span class="timeline-card-date">${escapeHtml(e.dateType === 'announcement' ? `公告 ${e.date.substring(5)}` : e.date.substring(5))}</span>
                  <div class="timeline-card-title">${escapeHtml(e.title)}</div>
                  <div class="timeline-card-meta">
                    <span class="timeline-card-game" style="color:var(--primary);">${escapeHtml(e.game)}</span>
                    <span>&middot;</span>
                    <span class="event-version-badge ${escapeHtml(e.gameKey)}" style="font-size:10px; padding: 1px 4px;">${escapeHtml(e.version || '通用')}</span>
                    <span>&middot;</span>
                    <span>${escapeHtml(e.type)}</span>
                  </div>
                </div>
                <div>
                  <span class="list-status-badge ${statusMeta(e.status).className}" style="font-size:10px; padding: 2px 6px;">
                    ${escapeHtml(e.status)}
                  </span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  // Bind click handlers to timeline elements
  elTimelineContainer.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      const eventObj = state.events.find(x => x.id === id);
      if (eventObj) openDetailModal(eventObj);
    });
  });
}

// Bookmarks toggle logic
function toggleBookmark(id) {
  const nextBookmarks = [...state.bookmarks];
  const index = nextBookmarks.indexOf(id);
  if (index === -1) {
    nextBookmarks.push(id);
  } else {
    nextBookmarks.splice(index, 1);
  }
  try {
    localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(nextBookmarks));
    state.bookmarks = nextBookmarks;
    return true;
  } catch (error) {
    console.warn('Unable to persist bookmarks:', error.message);
    alert('收藏保存失败：浏览器本地存储不可用。');
    return false;
  }
}

// Detail Popup modal logic
function openDetailModal(eventObj) {
  state.selectedEvent = eventObj;
  
  const fallbackCover = gameCovers[eventObj.gameKey] || gameCovers.all;
  const screenshotUrl = safeScreenshotUrl(eventObj.id);
  if (eventObj.status === '已失效' || !screenshotUrl) {
    elModalHeroImg.src = fallbackCover;
  } else {
    elModalHeroImg.src = screenshotUrl;
    elModalHeroImg.onerror = function() {
      this.onerror = null;
      this.src = fallbackCover;
    };
  }
  elModalTitle.textContent = eventObj.title;
  elModalDate.textContent = formatEventDate(eventObj);
  elModalVersion.textContent = eventObj.version || '通用';
  elModalType.textContent = eventObj.type;
  elModalDesc.textContent = eventObj.description || '暂无该活动的详细说明。该活动是米哈游推出的官方网页活动之一。';
  
  // Game badge styling
  elModalGameBadge.textContent = eventObj.game;
  elModalGameBadge.className = `modal-game-badge ${eventObj.gameKey}`;
  
  // Status badge styling
  elModalStatusBadge.textContent = eventObj.status;
  elModalStatusBadge.className = `status-badge modal-status-badge ${statusMeta(eventObj.status).className}`;
  
  // Primary action button href
  const externalUrl = safeExternalUrl(eventObj.url);
  if (externalUrl) {
    elModalPrimaryLink.href = externalUrl;
    elModalPrimaryLink.removeAttribute('aria-disabled');
  } else {
    elModalPrimaryLink.removeAttribute('href');
    elModalPrimaryLink.setAttribute('aria-disabled', 'true');
  }
  
  // Tags rendering
  elModalTags.replaceChildren(...eventObj.tags.map(tag => {
    const badge = document.createElement('span');
    badge.className = 'event-tag-badge';
    badge.textContent = tag;
    return badge;
  }));
  
  updateModalFavoriteButton();
  
  // Show Modal
  elDetailModal.classList.add('active');
}

function closeModal() {
  elDetailModal.classList.remove('active');
  state.selectedEvent = null;
}

function updateModalFavoriteButton() {
  if (!state.selectedEvent) return;
  const isBookmarked = state.bookmarks.includes(state.selectedEvent.id);
  elModalFavoriteBtn.classList.toggle('active', isBookmarked);
  const starIcon = elModalFavoriteBtn.querySelector('i');
  starIcon.className = isBookmarked ? 'fa-solid fa-star' : 'fa-regular fa-star';
}


