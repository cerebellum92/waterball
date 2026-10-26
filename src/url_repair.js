// BBS columns, matching TermBuf's single-/double-cell width policy.
export function bbsColumns(text) {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    width += code <= 0x7f || (code >= 0xff61 && code <= 0xffdf) || (code >= 0xffe8 && code <= 0xffee) ? 1 : 2;
  }
  return width;
}

export function repairBrokenUrl(line1, line2, prevAuthor = null, { columns = 80 } = {}) {
  if (typeof line1 !== 'string' || typeof line2 !== 'string' || !Number.isInteger(columns) || columns < 1 || columns > 512) return null;
  if (/[\x00-\x1f\x7f]/.test(line1 + line2)) return null;
  // A trailing slash is not evidence of wrapping. Require the actual content to
  // reach the physical margin; padding must not manufacture that evidence.
  const first = line1.trimEnd();
  if (bbsColumns(first) !== columns) return null;
  if (/^\s*(?:作者|標題|時間|看板)\s*[:：]|^\s*(?:※|--$|───|═══)/.test(first)) return null;

  const push = text => text.match(/^([推噓→])\s+([a-zA-Z][a-zA-Z0-9_]{1,11})\s*[:：]\s*/);
  const firstPush = push(first), nextPush = push(line2.trimStart());
  if (nextPush && (!firstPush || !prevAuthor || firstPush[2].toLowerCase() !== prevAuthor.toLowerCase() || nextPush[2].toLowerCase() !== prevAuthor.toLowerCase())) return null;
  if (firstPush && !nextPush && !/^ {2,}\S/.test(line2)) return null;
  const quote1 = first.match(/^\s*((?:[:>]\s*)+)/)?.[1]?.replace(/\s/g, '') || '';
  const quote2 = line2.match(/^\s*((?:[:>]\s*)+)/)?.[1]?.replace(/\s/g, '') || '';
  if (quote1 !== quote2) return null;
  if (/^\s*(?:作者|標題|時間|看板)\s*[:：]|^\s*(?:※|--$|───|═══)/.test(line2)) return null;

  const match = first.match(/(?:https?:\/\/|telnet:\/\/|ftp:\/\/|www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|ptt\.cc\/)[^\s\x00-\x1f<>"'()]+$/i);
  if (!match) return null;
  const urlPart1 = match[0];
  const normalize = raw => /^(?:https?|ftp|telnet):\/\//i.test(raw) ? raw : `https://${raw}`;
  // Never complete a host or userinfo across rows. Only path/query/fragment.
  if (!/^[a-z]+:\/\/[^/?#]+[/?#]/i.test(normalize(urlPart1))) return null;

  let prefix = line2.match(/^\s*/)[0].length;
  if (quote2) prefix += line2.slice(prefix).match(/^(?:[:>]\s*)+/)[0].length;
  if (nextPush) prefix += nextPush[0].length;
  const next = line2.slice(prefix);
  if (/^(?:[a-z][a-z0-9+.-]*:|www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|ptt\.cc\/)/i.test(next)) return null;
  const token = next.match(/^[a-zA-Z0-9_.~!*'();:@&=+$,/?#[\]%-]+/)?.[0];
  if (!token || (next.length > token.length && !/^\s/.test(next.slice(token.length)))) return null;
  const repairedRaw = urlPart1 + token, repairedUrl = normalize(repairedRaw);
  if (/%(?![a-f0-9]{2})/i.test(repairedUrl)) return null;
  try {
    const before = new URL(normalize(urlPart1)), after = new URL(repairedUrl);
    if (before.protocol !== after.protocol || before.hostname !== after.hostname || before.port !== after.port || before.username || before.password || after.username || after.password) return null;
    if (!before.search && !before.hash && /\.(?:jpe?g|png|gif|webp|bmp|svg|html?|pdf|txt|zip)$/i.test(before.pathname) && !/^[?#]/.test(token)) return null;
    const youtubeId = url => /^(?:www\.|m\.)?youtube\.com$/i.test(url.hostname)
      ? url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|v)\/([^/]+)$/)?.[1]
      : /^youtu\.be$/i.test(url.hostname) ? url.pathname.slice(1) : null;
    const firstVideo = youtubeId(before), fullVideo = youtubeId(after);
    const completedVideo = firstVideo && firstVideo.length < 11 && /^[A-Za-z0-9_-]{11}$/.test(fullVideo || '');
    // Arbitrary English words remain ambiguous even at the margin. A slash on
    // its own is insufficient; opaque suffixes are only accepted for known IDs.
    if (!/[/?=&.#%]/.test(token) && !/[?&=]$/.test(urlPart1) && !completedVideo) return null;

  } catch { return null; }
  return {
    urlPart1, urlStartCol: match.index, urlEndCol: match.index + urlPart1.length - 1,
    contToken: token, contStartCol: prefix, contEndCol: prefix + token.length - 1,
    repairedUrl, repairedRaw,
  };
}
