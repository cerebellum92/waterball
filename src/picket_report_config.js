// Picket Report Templates, Formatting & Storage Management for Waterball

export const DEFAULT_PICKET_TEMPLATES = {
  gossiping: {
    key: 'gossiping',
    board: 'Gossiping',
    picketBoard: 'GossipPicket',
    name: '八卦板檢舉 (GossipPicket)',
    titleFormat: '[檢舉] {targetAuthor} {ruleClause}',
    bodyFormat: `一、檢舉人ID：
    {reporter}

二、被檢舉人ID：
    {targetAuthor}

三、檢舉標的：
    文章代碼(AID)：{aid} ({board})
    文章網址：{webUrl}
    文章標題：{title}

四、違規事實與條款：
    違反條款：{ruleClause}
    違規事證：
{violationContent}`,
    suggestedRules: [
      '板規七（蔓延/政問）',
      '板規四（人身攻擊/謾罵）',
      '板規二（濫用問卦）',
      '板規一（引戰）',
      '板規八（無實質內容）',
    ],
  },
  stock: {
    key: 'stock',
    board: 'Stock',
    picketBoard: 'StockPicket',
    name: '股板檢舉 (StockPicket)',
    titleFormat: '[檢舉] {targetAuthor} {aid}',
    bodyFormat: `一、檢舉人：{reporter}
二、被檢舉人：{targetAuthor}
三、文章代碼(AID)：{aid} ({board})
四、文章網址：{webUrl}
五、違規事證與說明：
{violationContent}
六、違反板規：
    {ruleClause}`,
    suggestedRules: [
      '4-1（無關股市/閒聊）',
      '4-2（人身攻擊/謾罵）',
      '4-3（政問/政治推文）',
      '1-2-3（多餘重複推文）',
      '4-5（無來源新聞/謠言）',
    ],
  },
  nba: {
    key: 'nba',
    board: 'NBA',
    picketBoard: 'NBA_Picket',
    name: 'NBA板檢舉 (NBA_Picket)',
    titleFormat: '[檢舉] {targetAuthor} {aid} {ruleClause}',
    bodyFormat: `1. 檢舉人：{reporter}
2. 被檢舉人：{targetAuthor}
3. 文章代碼(AID)：{aid} ({board})
4. 違規事實/事證：
{violationContent}
5. 違反板規：
   {ruleClause}`,
    suggestedRules: [
      '板規一（人身攻擊/謾罵球員板友）',
      '板規二（無意義一行文/鬧板）',
      '板規三（轉錄未附來源/未翻譯）',
      '板規四（政治文/無關NBA）',
      '板規七（洗板/重複推文）',
    ],
  },
  baseball: {
    key: 'baseball',
    board: 'Baseball',
    picketBoard: 'SP2_Baseball',
    name: '棒球板檢舉 (SP2_Baseball)',
    titleFormat: '[檢舉] {targetAuthor} {aid}',
    bodyFormat: `一、檢舉人：{reporter}
二、被檢舉人：{targetAuthor}
三、文章代碼(AID)：{aid} ({board})
四、事證與違規說明：
{violationContent}
五、違反板規：
    {ruleClause}`,
    suggestedRules: [
      'B-1（無關棒球）',
      'B-2（挑釁/謾罵/人身攻擊）',
      'B-3（非正式體育政治文）',
      'B-6（一行文/無意義問卦）',
      'B-17（洗板/推文妨礙閱讀）',
    ],
  },
  c_chat: {
    key: 'c_chat',
    board: 'C_Chat',
    picketBoard: 'C_ChatBM',
    name: '西洽板檢舉 (C_ChatBM)',
    titleFormat: '[檢舉] {targetAuthor} {ruleClause}',
    bodyFormat: `一、被檢舉人：{targetAuthor}
二、文章代碼(AID)：{aid} ({board})
三、違規內容：
{violationContent}
四、違反板規：
    {ruleClause}
五、檢舉事由：
    請板主依板規處理。`,
    suggestedRules: [
      '4-1（無 ACG 點）',
      '4-5（人身攻擊/辱罵板友）',
      '4-7（政治推文/違規宣傳）',
      '4-11（洗板/鬧板）',
      '4-13（捏他暴雷未防雷）',
    ],
  },
  general: {
    key: 'general',
    board: 'General',
    picketBoard: '',
    name: '通用看板檢舉',
    titleFormat: '[檢舉] {targetAuthor} {aid} {ruleClause}',
    bodyFormat: `被檢舉人：{targetAuthor}
文章代碼(AID)：{aid} ({board})
文章標題：{title}
文章網址：{webUrl}

違規事證：
{violationContent}

違反板規條款：
{ruleClause}`,
    suggestedRules: [
      '謾罵/人身攻擊',
      '洗板/大量重複推文',
      '政治推文',
      '無關看板主旨',
      '廣告/商業推廣',
    ],
  },
};

const STORAGE_KEY = 'waterball_picket_templates_v1';

/**
 * Replace placeholders in template with provided variables.
 * @param {string} templateStr
 * @param {Record<string, string>} [vars={}]
 * @returns {string}
 */
export function renderTemplate(templateStr, vars = {}) {
  if (typeof templateStr !== 'string') return '';
  return templateStr.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return vars[key] !== undefined && vars[key] !== null ? vars[key] : match;
  });
}

export class PicketTemplateManager {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.templates = {};
    this.loadTemplates();
  }

  loadTemplates() {
    this.templates = JSON.parse(JSON.stringify(DEFAULT_PICKET_TEMPLATES));
    if (!this.storage) return;

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          Object.assign(this.templates, saved);
        }
      }
    } catch (e) {
      console.warn('Failed to load picket templates from storage:', e);
    }
  }

  saveToStorage() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.templates));
    } catch (e) {
      console.warn('Failed to save picket templates to storage:', e);
    }
  }

  getAll() {
    return Object.values(this.templates);
  }

  getTemplate(key) {
    if (!key) return this.templates.general || DEFAULT_PICKET_TEMPLATES.general;
    const clean = String(key).trim().toLowerCase();
    return this.templates[clean] || null;
  }

  getTemplateForBoard(boardName) {
    if (!boardName) return this.templates.general || DEFAULT_PICKET_TEMPLATES.general;
    const clean = String(boardName).trim().toLowerCase();
    
    // Direct match by key or board
    for (const t of Object.values(this.templates)) {
      if (t.key.toLowerCase() === clean || (t.board && t.board.toLowerCase() === clean)) {
        return t;
      }
    }

    return this.templates.general || DEFAULT_PICKET_TEMPLATES.general;
  }

  saveTemplate(key, templateObj) {
    if (!key || typeof templateObj !== 'object') return false;
    const cleanKey = String(key).trim().toLowerCase();
    this.templates[cleanKey] = {
      ...templateObj,
      key: cleanKey,
    };
    this.saveToStorage();
    return true;
  }

  deleteTemplate(key) {
    if (!key) return false;
    const cleanKey = String(key).trim().toLowerCase();
    if (cleanKey === 'general') return false; // Prevent deleting general fallback
    
    if (this.templates[cleanKey]) {
      delete this.templates[cleanKey];
      this.saveToStorage();
      return true;
    }
    return false;
  }

  resetToDefaults() {
    this.templates = JSON.parse(JSON.stringify(DEFAULT_PICKET_TEMPLATES));
    if (this.storage) {
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch {}
    }
    return this.templates;
  }
}

export const picketTemplateManager = new PicketTemplateManager();
