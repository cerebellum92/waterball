// Quick Board Switcher (Cmd+K) for bbsterm

export const POPULAR_BOARDS = [
  { id: 'Gossiping', name: '八卦板', category: '綜合時事', desc: 'PTT 最大熱門綜合看板' },
  { id: 'Stock', name: '股板', category: '理財投資', desc: '台股美股各類投資討論' },
  { id: 'C_Chat', name: '西洽板', category: '動漫電玩', desc: '動漫、漫畫與ACG綜合討論' },
  { id: 'Beauty', name: '表特板', category: '帥哥美女', desc: '正妹帥哥圖文分享' },
  { id: 'Baseball', name: '棒球板', category: '體育賽事', desc: '中華職棒與MLB/國際賽' },
  { id: 'NBA', name: 'NBA板', category: '體育賽事', desc: '美國職籃與球星討論' },
  { id: 'Movie', name: '電影板', category: '影視娛樂', desc: '電影心得、影評與預告' },
  { id: 'Lifeismoney', name: '省錢板', category: '生活情報', desc: '網購、超商與各類特價好康' },
  { id: 'car', name: '車板', category: '汽機車', desc: '汽車賞車、購車與用車心得' },
  { id: 'Tech_Job', name: '科技工作板', category: '職場工作', desc: '半導體、竹科與科技業薪資' },
  { id: 'Soft_Job', name: '軟體工作板', category: '職場工作', desc: '軟體工程師、求職與技術交流' },
  { id: 'iOS', name: 'iOS板', category: '數位科技', desc: 'iPhone、iPad 與 Apple 討論' },
  { id: 'MobileComm', name: '通訊板', category: '數位科技', desc: '智慧型手機與各家電信方案' },
  { id: 'LoL', name: '英雄聯盟', category: '電子競技', desc: 'League of Legends 遊戲與賽事' },
  { id: 'Steam', name: 'Steam板', category: '電腦遊戲', desc: 'PC 遊戲特價、心得與推坑' },
  { id: 'PC_Shopping', name: '電蝦板', category: '電腦硬體', desc: '電腦菜單、組裝與硬體特惠' },
  { id: 'HardwareSale', name: '硬體買賣板', category: '二手交易', desc: '電腦零組件二手買賣' },
  { id: 'AllTogether', name: '歐兔板', category: '聯誼交友', desc: '聯誼、徵友與約會' },
  { id: 'WomenTalk', name: '女孩板', category: '生活心情', desc: '女性話題、生活與閒聊' },
  { id: 'Boy-Girl', name: '男女板', category: '感情生活', desc: '感情問題、相處與婚姻' },
  { id: 'Kaohsiung', name: '高雄板', category: '地方看板', desc: '高雄大小事與生活美食' },
  { id: 'TaichungBun', name: '台中板', category: '地方看板', desc: '台中生活、活動與美食' },
  { id: 'Tainan', name: '台南板', category: '地方看板', desc: '台南生活、景點與美食' },
  { id: 'joke', name: '就可板', category: '趣味歡樂', desc: '笑話、迷因與好笑梗圖' },
  { id: 'marvel', name: '媽佛板', category: '靈異經驗', desc: '鬼故事、都市傳說與靈異經驗' },
  { id: 'Military', name: '軍事板', category: '國際國防', desc: '各國軍武、戰略與國防戰事' },
  { id: 'HatePolitics', name: '政黑板', category: '時事政論', desc: '政治時事與評論' },
  { id: 'KoreaStar', name: '韓星板', category: '影視娛樂', desc: 'K-POP、韓劇與偶像明星' },
];

export class BoardSwitcherWidget {
  constructor(sendDataCallback) {
    this.sendData = sendDataCallback;
    this.isOpen = false;
    this.selectedIndex = 0;
    this.filtered = [];
    this.widgetEl = null;
    this.inputEl = null;
    this.listEl = null;
    this.createDom();
  }

  createDom() {
    const widget = document.createElement('div');
    widget.id = 'board-switcher-widget';
    widget.className = 'board-switcher-backdrop hidden';

    widget.innerHTML = `
      <div class="board-switcher-modal">
        <div class="board-switcher-search-bar">
          <span class="bs-search-icon">⚡</span>
          <input type="text" id="bs-search-input" placeholder="搜尋看板（中英文板名，如 八卦、Stock、Beauty...）" autocomplete="off" spellcheck="false" />
          <span class="bs-key-hint">ESC 退出</span>
        </div>
        <div class="board-switcher-list" id="bs-list"></div>
        <div class="board-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 移動選擇</span>
          <span><kbd>↵</kbd> 一鍵直達看板 (s + 板名)</span>
          <span><kbd>ESC</kbd> 關閉</span>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    this.widgetEl = widget;
    this.inputEl = widget.querySelector('#bs-search-input');
    this.listEl = widget.querySelector('#bs-list');

    // Click backdrop to close
    widget.addEventListener('click', (e) => {
      if (e.target === widget) this.close();
    });

    // Input search events
    this.inputEl.addEventListener('input', () => {
      this.filter(this.inputEl.value);
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  filter(query) {
    const q = (query || '').trim().toLowerCase();
    let matches = [];

    if (!q) {
      matches = [...POPULAR_BOARDS];
    } else {
      matches = POPULAR_BOARDS.filter((b) => {
        return (
          b.id.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (b.desc && b.desc.toLowerCase().includes(q))
        );
      });

      // If user typed custom query not exact match, prepend custom board jump
      const exactMatch = matches.some((b) => b.id.toLowerCase() === q);
      if (!exactMatch && query.trim().length > 0) {
        matches.unshift({
          id: query.trim(),
          name: `自訂看板 [${query.trim()}]`,
          category: '自訂搜尋',
          desc: `直接發送 s + ${query.trim()} 跳轉`,
          isCustom: true,
        });
      }
    }

    this.filtered = matches;
    this.selectedIndex = 0;
    this.renderList();
  }

  renderList() {
    this.listEl.innerHTML = '';

    if (this.filtered.length === 0) {
      this.listEl.innerHTML = '<div class="bs-empty">沒有找到相符的看板</div>';
      return;
    }

    this.filtered.forEach((board, index) => {
      const item = document.createElement('div');
      item.className = `bs-item ${index === this.selectedIndex ? 'selected' : ''}`;

      item.innerHTML = `
        <div class="bs-item-left">
          <span class="bs-item-id">${board.id}</span>
          <span class="bs-item-name">${board.name}</span>
          <span class="bs-item-category">${board.category}</span>
        </div>
        <div class="bs-item-desc">${board.desc || ''}</div>
      `;

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelectionHighlight();
      });

      item.addEventListener('click', () => {
        this.selectedIndex = index;
        this.executeSelected();
      });

      this.listEl.appendChild(item);
    });

    this.scrollSelectedIntoView();
  }

  selectNext() {
    if (this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
    this.updateSelectionHighlight();
    this.scrollSelectedIntoView();
  }

  selectPrev() {
    if (this.filtered.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.filtered.length) % this.filtered.length;
    this.updateSelectionHighlight();
    this.scrollSelectedIntoView();
  }

  updateSelectionHighlight() {
    const items = this.listEl.querySelectorAll('.bs-item');
    items.forEach((it, idx) => {
      it.classList.toggle('selected', idx === this.selectedIndex);
    });
  }

  scrollSelectedIntoView() {
    const selectedItem = this.listEl.querySelector('.bs-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }

  executeSelected() {
    if (this.filtered.length === 0) return;
    const board = this.filtered[this.selectedIndex];
    if (!board || !board.id) return;

    this.jumpToBoard(board.id);
    this.close();
  }

  jumpToBoard(boardId) {
    // Send PTT standard search board command sequence: 's' + boardId + '\r'
    // E.g. "sStock\r" or "sGossiping\r"
    const navSeq = `s${boardId}\r`;
    this.sendData?.(navSeq);
  }

  open() {
    this.isOpen = true;
    this.widgetEl.classList.remove('hidden');
    this.inputEl.value = '';
    this.filter('');
    this.inputEl.focus();
  }

  close() {
    this.isOpen = false;
    this.widgetEl.classList.add('hidden');
  }
}
