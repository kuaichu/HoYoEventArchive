import './style.css';
import eventsData from './events.json';
import {
  escapeHtml,
  gameKeyForName,
  normalizeEvent,
  safeExternalUrl,
  statusMeta,
  validateEvent
} from './event-domain.js';
import {
  createEmptyEventOverlay,
  deleteEventFromOverlay,
  mergeEventState,
  nextEventId,
  parsePersistedEventState,
  serializeEventState,
  upsertEventInOverlay
} from './event-storage.js';

const EVENT_STORAGE_KEY = 'hoyo_archive_custom_events';
const LEGACY_EVENT_STORAGE_BACKUP_KEY = `${EVENT_STORAGE_KEY}_legacy_backup`;

function loadEventOverlay() {
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
  return parsed.overlay;
}

// Application State
const state = {
  overlay: loadEventOverlay(),
  events: []
};
state.events = mergeEventState(eventsData, state.overlay);

function readLatestOverlay() {
  try {
    const raw = localStorage.getItem(EVENT_STORAGE_KEY);
    return parsePersistedEventState(raw, eventsData).overlay;
  } catch (error) {
    console.warn('Unable to refresh local event edits:', error.message);
    return state.overlay;
  }
}

function commitOverlay(updateOverlay) {
  try {
    const nextOverlay = updateOverlay(readLatestOverlay());
    localStorage.setItem(EVENT_STORAGE_KEY, serializeEventState(nextOverlay));
    state.overlay = nextOverlay;
    state.events = mergeEventState(eventsData, state.overlay);
    return true;
  } catch (error) {
    console.error('Unable to persist local event edits:', error);
    alert('保存失败：浏览器本地存储不可用或空间不足。');
    return false;
  }
}

// DOM Elements
let elAdminEventsList;
let elAdminAddBtn;
let elAdminExportBtn;
let elAdminResetBtn;
let elAdminSearchInput;
let elAdminFormContainer;

let elFormTitle;
let elFormEventId;
let elFormEventTitle;
let elFormEventUrl;
let elFormEventGame;
let elFormEventType;
let elFormEventStatus;
let elFormEventDate;
let elFormEventTags;
let elFormEventVersion;
let elFormEventDesc;
let elFormCancelBtn;
let elFormSaveBtn;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  bindEvents();
  renderAdminEvents();
  setupStyles();
});

// Cache DOM Elements
function initDOM() {
  elAdminEventsList = document.getElementById('adminEventsList');
  elAdminAddBtn = document.getElementById('adminAddBtn');
  elAdminExportBtn = document.getElementById('adminExportBtn');
  elAdminResetBtn = document.getElementById('adminResetBtn');
  elAdminSearchInput = document.getElementById('adminSearchInput');
  elAdminFormContainer = document.getElementById('adminFormContainer');

  elFormTitle = document.getElementById('formTitle');
  elFormEventId = document.getElementById('formEventId');
  elFormEventTitle = document.getElementById('formEventTitle');
  elFormEventUrl = document.getElementById('formEventUrl');
  elFormEventGame = document.getElementById('formEventGame');
  elFormEventType = document.getElementById('formEventType');
  elFormEventStatus = document.getElementById('formEventStatus');
  elFormEventDate = document.getElementById('formEventDate');
  elFormEventTags = document.getElementById('formEventTags');
  elFormEventVersion = document.getElementById('formEventVersion');
  elFormEventDesc = document.getElementById('formEventDesc');
  elFormCancelBtn = document.getElementById('formCancelBtn');
  elFormSaveBtn = document.getElementById('formSaveBtn');
}

// Inject hover and interactive styles for custom admin tables
function setupStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #adminEventsList tr:hover {
      background: rgba(255, 255, 255, 0.03) !important;
    }
    .control-tab {
      transition: all 0.2s ease;
    }
    .control-tab:hover {
      background: rgba(93, 107, 250, 0.3) !important;
      transform: translateY(-1px);
    }
    .control-tab[data-delete-id]:hover {
      background: rgba(248, 113, 113, 0.3) !important;
    }
  `;
  document.head.appendChild(style);
}

// Render administrative events list
function renderAdminEvents() {
  const query = elAdminSearchInput.value.trim().toLowerCase();
  let list = [...state.events];

  if (query) {
    list = list.filter(e => 
      e.title.toLowerCase().includes(query) ||
      e.game.toLowerCase().includes(query) ||
      (e.version && e.version.toLowerCase().includes(query)) ||
      e.type.toLowerCase().includes(query) ||
      (e.id && e.id.toLowerCase().includes(query)) ||
      (e.url && e.url.toLowerCase().includes(query)) ||
      e.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  // Sort by date descending in admin view to see recent first
  list.sort((a, b) => new Date(b.date.replace(/\./g, '/')) - new Date(a.date.replace(/\./g, '/')));

  elAdminEventsList.innerHTML = list.map(e => {
    const statusClass = statusMeta(e.status).className;
    const externalUrl = safeExternalUrl(e.url);
    const titleCell = externalUrl
      ? `<a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer" style="color: white; text-decoration: none; hover:text-decoration: underline;">${escapeHtml(e.title)}</a>`
      : `<span title="链接格式无效">${escapeHtml(e.title)}</span>`;
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
        <td style="padding: 14px 20px; font-family: 'Outfit'; color: var(--text-muted); font-size: 13px;">${escapeHtml(e.id)}</td>
        <td style="padding: 14px 20px; font-weight: 600; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${titleCell}
        </td>
        <td style="padding: 14px 20px; color: var(--text-accent);">${escapeHtml(e.game)}</td>
        <td style="padding: 14px 20px;">
          <span class="event-version-badge ${escapeHtml(e.gameKey)}" style="font-size:10px; padding: 2px 6px;">${escapeHtml(e.version || '通用')}</span>
        </td>
        <td style="padding: 14px 20px; color: var(--text-secondary);">${escapeHtml(e.type)}</td>
        <td style="padding: 14px 20px;">
          <span class="list-status-badge ${statusClass}" style="font-size:10px; padding: 2px 6px;">${escapeHtml(e.status)}</span>
        </td>
        <td style="padding: 14px 20px;">
          <div style="display: flex; justify-content: center; gap: 8px;">
            <button class="control-tab" data-edit-id="${escapeHtml(e.id)}" style="padding: 4px 10px; font-size: 11px; background: rgba(93,107,250,0.15); border: 1px solid rgba(93,107,250,0.3); color: white; border-radius: 4px; cursor: pointer;">
              编辑
            </button>
            <button class="control-tab" data-delete-id="${escapeHtml(e.id)}" style="padding: 4px 10px; font-size: 11px; background: rgba(248,113,113,0.15); border: 1px solid rgba(248,113,113,0.3); color: var(--status-expired); border-radius: 4px; cursor: pointer;">
              删除
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind edit & delete buttons
  elAdminEventsList.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-id');
      const eventObj = state.events.find(x => x.id === id);
      if (eventObj) showAdminForm(eventObj);
    });
  });

  elAdminEventsList.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-id');
      deleteAdminEvent(id);
    });
  });
}

// Handle administrative list search
function handleAdminSearch() {
  renderAdminEvents();
}

// Show form container
function showAdminForm(eventObj = null) {
  elAdminFormContainer.classList.remove('hidden');
  
  if (eventObj) {
    elFormTitle.textContent = `编辑活动档案 (${eventObj.id})`;
    elFormEventId.value = eventObj.id;
    elFormEventTitle.value = eventObj.title;
    elFormEventUrl.value = eventObj.url;
    elFormEventGame.value = eventObj.game;
    elFormEventType.value = eventObj.type;
    elFormEventStatus.value = eventObj.status;
    elFormEventDate.value = eventObj.date;
    elFormEventTags.value = eventObj.tags.join(',');
    elFormEventVersion.value = eventObj.version || '';
    elFormEventDesc.value = eventObj.description || '';
  } else {
    elFormTitle.textContent = '新增活动档案';
    elFormEventId.value = '';
    elFormEventTitle.value = '';
    elFormEventUrl.value = '';
    elFormEventGame.value = '原神';
    elFormEventType.value = '小游戏';
    elFormEventStatus.value = '可访问';
    elFormEventDate.value = new Date().toISOString().substring(0, 10).replace(/-/g, '.'); // Default: current YYYY.MM.DD
    elFormEventTags.value = '';
    elFormEventVersion.value = '';
    elFormEventDesc.value = '';
  }
  
  // Scroll to form
  elAdminFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Hide form container
function hideAdminForm() {
  elAdminFormContainer.classList.add('hidden');
  elFormEventId.value = '';
  elFormEventTitle.value = '';
  elFormEventUrl.value = '';
  elFormEventTags.value = '';
  elFormEventVersion.value = '';
  elFormEventDesc.value = '';
}

// Save or add admin event
function saveAdminEvent() {
  const title = elFormEventTitle.value.trim();
  const url = elFormEventUrl.value.trim();
  const game = elFormEventGame.value;
  const type = elFormEventType.value;
  const status = elFormEventStatus.value;
  const date = elFormEventDate.value.trim();
  const tagsStr = elFormEventTags.value.trim();
  const version = elFormEventVersion.value.trim();
  const description = elFormEventDesc.value.trim();

  if (!title || !url || !date) {
    alert('请填写带星号 (*) 的必填字段！');
    return;
  }

  // Parse tags
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

  const gameKey = gameKeyForName(game);
  const externalUrl = safeExternalUrl(url);
  if (!externalUrl) {
    alert('网页链接必须是有效的 HTTP 或 HTTPS 地址，且不能包含用户名或密码。');
    return;
  }

  const id = elFormEventId.value;
  let event;
  if (id) {
    const currentEvent = state.events.find(e => e.id === id);
    if (!currentEvent) {
      alert('未找到要编辑的活动，可能已在其他页面被删除。');
      return;
    }
    event = normalizeEvent({
        ...currentEvent,
        id,
        title,
        url: externalUrl,
        game,
        gameKey,
        type,
        status,
        date,
        tags,
        version: version || '通用',
        description
      }, currentEvent);
  } else {
    const newId = nextEventId(gameKey, eventsData, readLatestOverlay());
    
    event = normalizeEvent({
      id: newId,
      title,
      url: externalUrl,
      game,
      gameKey,
      type,
      status,
      date,
      tags,
      version: version || '通用',
      description
    });
  }

  const validationIssues = validateEvent(event);
  if (validationIssues.length > 0) {
    alert(`活动数据无效：\n${validationIssues.join('\n')}`);
    return;
  }

  if (!commitOverlay(currentOverlay => (
    upsertEventInOverlay(currentOverlay, eventsData, event)
  ))) return;

  // Reset and update
  hideAdminForm();
  renderAdminEvents();
  
  alert('活动档案保存成功！(修改已同步保存至本地缓存)');
}

// Delete administrative event
function deleteAdminEvent(eventId) {
  if (confirm(`确定要删除活动档案 ${eventId} 吗？`)) {
    if (!commitOverlay(currentOverlay => (
      deleteEventFromOverlay(currentOverlay, eventsData, eventId)
    ))) return;

    // Reset and update
    hideAdminForm();
    renderAdminEvents();
  }
}

// Export database as JSON download
function exportDatabaseJson() {
  const jsonStr = JSON.stringify(state.events, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'events.json';
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  alert('数据库 JSON 导出成功！您可直接使用下载的文件替换项目中的 src/events.json。');
}

// Reset database defaults
function resetDatabaseDefaults() {
  if (confirm('确定要清除所有自定义修改，恢复至档案馆默认数据吗？此操作不可逆！')) {
    try {
      localStorage.removeItem(EVENT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_EVENT_STORAGE_BACKUP_KEY);
      state.overlay = createEmptyEventOverlay();
      state.events = mergeEventState(eventsData, state.overlay);
    } catch (error) {
      console.error('Unable to reset local event edits:', error);
      alert('重置失败：浏览器本地存储不可用。');
      return;
    }
    
    // Reset and update
    hideAdminForm();
    if (elAdminSearchInput) elAdminSearchInput.value = '';
    renderAdminEvents();
    
    alert('已成功清除本地缓存并还原默认活动数据库！');
  }
}

// Bind all listener events
function bindEvents() {
  elAdminAddBtn.addEventListener('click', () => showAdminForm());
  elAdminExportBtn.addEventListener('click', exportDatabaseJson);
  elAdminResetBtn.addEventListener('click', resetDatabaseDefaults);
  elAdminSearchInput.addEventListener('input', handleAdminSearch);
  elFormCancelBtn.addEventListener('click', hideAdminForm);
  elFormSaveBtn.addEventListener('click', saveAdminEvent);
}
