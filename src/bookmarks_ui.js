// Bookmarks UI Controller for Waterball BBS

export class BookmarksUI {
  constructor({
    settingsManager,
    addressInput,
    encodingSelect,
    bookmarksSelect,
    addBookmarkBtn,
    bookmarkList,
    inputs: { bmInputName, bmInputAddr, bmInputEnc, bmInputUser, bmInputPass, bmBtnAdd, btnResetDefaultBookmarks },
    onConnect,
    onCloseModal,
    onFocusTerminal,
    onShowToast,
  }) {
    this.settingsManager = settingsManager;
    this.addressInput = addressInput;
    this.encodingSelect = encodingSelect;
    this.bookmarksSelect = bookmarksSelect;
    this.addBookmarkBtn = addBookmarkBtn;
    this.bookmarkList = bookmarkList;
    this.inputs = { bmInputName, bmInputAddr, bmInputEnc, bmInputUser, bmInputPass, bmBtnAdd, btnResetDefaultBookmarks };
    this.onConnect = onConnect || (() => {});
    this.onCloseModal = onCloseModal || (() => {});
    this.onFocusTerminal = onFocusTerminal || (() => {});
    this.onShowToast = onShowToast || (() => {});

    this.initEventListeners();
  }

  initEventListeners() {
    // Toolbar bookmarks dropdown selection
    if (this.bookmarksSelect) {
      this.bookmarksSelect.addEventListener('change', () => {
        const bm = this.settingsManager.bookmarks.find((b) => b.id === this.bookmarksSelect.value);
        if (bm) {
          if (this.addressInput) this.addressInput.value = bm.address;
          if (this.encodingSelect) this.encodingSelect.value = bm.encoding || 'big5';
          this.bookmarksSelect.selectedIndex = 0;
          this.bookmarksSelect.blur();
          this.onFocusTerminal(true);
          this.onConnect(bm);
        }
      });
    }

    // Quick Add Bookmark from Address Bar button
    if (this.addBookmarkBtn) {
      this.addBookmarkBtn.addEventListener('click', () => {
        const addr = this.addressInput?.value?.trim();
        if (!addr) return;
        const name = addr.split(':')[0].replace(/.*@/, '') || '我的 BBS 站台';
        this.settingsManager.addBookmark({
          name,
          address: addr,
          encoding: this.encodingSelect?.value || 'big5',
        });
        this.renderBookmarksSelect();
        this.renderBookmarkList();
        this.onShowToast('已存入常用書籤');
      });
    }

    // Inline Bookmark Add in Settings Modal
    const { bmBtnAdd, bmInputName, bmInputAddr, bmInputEnc, bmInputUser, bmInputPass, btnResetDefaultBookmarks } = this.inputs;
    if (bmBtnAdd) {
      bmBtnAdd.addEventListener('click', async () => {
        const name = bmInputName?.value?.trim();
        const addr = bmInputAddr?.value?.trim();
        const enc = bmInputEnc?.value || 'big5';
        const user = bmInputUser?.value?.trim() || '';
        const pass = bmInputPass?.value?.trim() || '';

        if (!name || !addr) {
          if (bmInputName && !name) bmInputName.focus();
          else if (bmInputAddr) bmInputAddr.focus();
          return;
        }

        await this.settingsManager.addBookmark({
          name,
          address: addr,
          encoding: enc,
          username: user,
          password: pass,
        });

        if (bmInputName) bmInputName.value = '';
        if (bmInputAddr) bmInputAddr.value = '';
        if (bmInputUser) bmInputUser.value = '';
        if (bmInputPass) bmInputPass.value = '';
        this.renderBookmarksSelect();
        this.renderBookmarkList();
      });
    }

    // Reset Default Bookmarks button
    if (btnResetDefaultBookmarks) {
      btnResetDefaultBookmarks.addEventListener('click', () => {
        this.settingsManager.resetDefaultBookmarks();
        this.renderBookmarksSelect();
        this.renderBookmarkList();
        this.onShowToast('已恢復預設站台書籤');
      });
    }
  }

  renderBookmarksSelect() {
    if (!this.bookmarksSelect) return;
    this.bookmarksSelect.innerHTML = '<option value="" disabled selected>⭐ 常用站台書籤...</option>';
    this.settingsManager.bookmarks.forEach((bm) => {
      const opt = document.createElement('option');
      opt.value = bm.id;
      opt.textContent = `${bm.name} (${bm.address})`;
      this.bookmarksSelect.appendChild(opt);
    });
  }

  renderBookmarkList() {
    if (!this.bookmarkList) return;
    this.bookmarkList.innerHTML = '';

    if (this.settingsManager.bookmarks.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.style.padding = '16px';
      emptyBox.style.textAlign = 'center';
      emptyBox.style.color = 'var(--text-secondary)';
      emptyBox.innerHTML = `<div>目前沒有任何書籤，可點擊上方按鈕恢復預設。</div>`;
      this.bookmarkList.appendChild(emptyBox);
      return;
    }

    this.settingsManager.bookmarks.forEach((bm) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';

      const info = document.createElement('div');
      info.className = 'bm-info';
      const autoLoginBadge = (bm.username && bm.password)
        ? `<span style="font-size: 11px; background: rgba(63, 185, 80, 0.18); color: var(--green); border: 1px solid rgba(63, 185, 80, 0.4); padding: 1px 6px; border-radius: 4px; margin-left: 6px;">🔐 自動登入 (${bm.username})</span>`
        : '';
      info.innerHTML = `
        <div class="bm-name">${bm.name} ${autoLoginBadge}</div>
        <div class="bm-address">${bm.address} [${bm.encoding || 'big5'}]</div>
      `;

      const btns = document.createElement('div');
      btns.className = 'bm-btns';

      const connBtn = document.createElement('button');
      connBtn.className = 'btn-primary';
      connBtn.textContent = '連線';
      connBtn.onclick = () => {
        if (this.addressInput) this.addressInput.value = bm.address;
        if (this.encodingSelect) this.encodingSelect.value = bm.encoding || 'big5';
        this.onCloseModal();
        this.onConnect(bm);
      };

      const editBtn = document.createElement('button');
      editBtn.className = 'btn-secondary';
      editBtn.textContent = '✏️ 編輯';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        this.renderInlineBookmarkEdit(item, bm);
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-danger';
      delBtn.textContent = '刪除';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.settingsManager.deleteBookmark(bm.id);
        this.renderBookmarksSelect();
        this.renderBookmarkList();
      };

      btns.appendChild(connBtn);
      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(btns);
      this.bookmarkList.appendChild(item);
    });
  }

  async renderInlineBookmarkEdit(item, bm) {
    let existingPass = '';
    if (bm.password) {
      const creds = await this.settingsManager.getDecryptedCredentials(bm);
      existingPass = creds?.password || '';
    }

    item.innerHTML = `
      <div class="bm-edit-box">
        <div style="font-size: 12px; font-weight: 600; color: var(--accent);">✏️ 編輯站台資訊與自動登入帳密</div>
        <div class="bm-edit-row">
          <input type="text" id="edit-name-${bm.id}" value="${bm.name}" placeholder="站台名稱" style="flex: 2;" />
          <input type="text" id="edit-addr-${bm.id}" value="${bm.address}" placeholder="位址 (如: bbs@ptt.cc:22)" style="flex: 3;" />
          <select id="edit-enc-${bm.id}" style="width: 85px; flex: none;">
            <option value="big5" ${bm.encoding === 'big5' ? 'selected' : ''}>Big5</option>
            <option value="utf-8" ${bm.encoding === 'utf-8' ? 'selected' : ''}>UTF-8</option>
            <option value="gbk" ${bm.encoding === 'gbk' ? 'selected' : ''}>GBK</option>
          </select>
        </div>
        <div class="bm-edit-row">
          <input type="text" id="edit-user-${bm.id}" value="${bm.username || ''}" placeholder="自動登入帳號 (選填)" />
          <input type="password" id="edit-pass-${bm.id}" value="${existingPass}" placeholder="自動登入密碼 (選填)" />
        </div>
        <div class="bm-edit-actions">
          <button id="edit-cancel-${bm.id}" class="btn-secondary">✕ 取消</button>
          <button id="edit-save-${bm.id}" class="btn-primary">💾 儲存修改</button>
        </div>
      </div>
    `;

    document.getElementById(`edit-save-${bm.id}`)?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = document.getElementById(`edit-name-${bm.id}`)?.value?.trim() || bm.name;
      const newAddr = document.getElementById(`edit-addr-${bm.id}`)?.value?.trim() || bm.address;
      const newEnc = document.getElementById(`edit-enc-${bm.id}`)?.value || 'big5';
      const newUser = document.getElementById(`edit-user-${bm.id}`)?.value?.trim() || '';
      const newPass = document.getElementById(`edit-pass-${bm.id}`)?.value?.trim() || '';

      await this.settingsManager.updateBookmark(bm.id, {
        name: newName,
        address: newAddr,
        encoding: newEnc,
        username: newUser,
        password: newPass,
      });

      this.renderBookmarksSelect();
      this.renderBookmarkList();
    });

    document.getElementById(`edit-cancel-${bm.id}`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.renderBookmarkList();
    });
  }
}
