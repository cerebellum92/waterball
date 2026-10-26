import test from 'node:test';
import assert from 'node:assert/strict';

// Mock DOM for ImagePreviewController loading
class MockElement {
  constructor() {
    this.children = [];
    this.style = {};
    this.classList = {
      classes: new Set(),
      add: (c) => this.classList.classes.add(c),
      remove: (c) => this.classList.classes.delete(c),
      contains: (c) => this.classList.classes.has(c),
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
}

globalThis.document ||= {
  body: new MockElement(),
  createElement: () => new MockElement(),
};
globalThis.window ||= { innerWidth: 1024, innerHeight: 768 };

const { isImageUrl, normalizeImageUrl, getProxiedImageUrl } = await import('../src/image_preview.js');

test('isImageUrl correctly identifies image URLs', () => {
  // Direct extensions
  assert.equal(isImageUrl('https://example.com/photo.jpg'), true);
  assert.equal(isImageUrl('https://example.com/photo.JPEG'), true);
  assert.equal(isImageUrl('https://example.com/photo.png?v=2'), true);
  assert.equal(isImageUrl('https://example.com/animation.gif'), true);
  assert.equal(isImageUrl('https://example.com/image.webp'), true);
  assert.equal(isImageUrl('https://example.com/vector.svg'), true);

  // Imgur
  assert.equal(isImageUrl('https://imgur.com/aBcDeFg'), true);
  assert.equal(isImageUrl('https://i.imgur.com/aBcDeFg.jpg'), true);
  assert.equal(isImageUrl('https://m.imgur.com/aBcDeFg'), true);

  // Twitter / X
  assert.equal(isImageUrl('https://pbs.twimg.com/media/GbC123456?format=jpg'), true);
  assert.equal(isImageUrl('https://pbs.twimg.com/media/GbC123456.jpg:large'), true);

  // Reddit
  assert.equal(isImageUrl('https://i.redd.it/abcdef123456.jpg'), true);
  assert.equal(isImageUrl('https://preview.redd.it/abcdef123456.png?width=640'), true);

  // Giphy
  assert.equal(isImageUrl('https://giphy.com/media/xyz123/giphy.gif'), true);
  assert.equal(isImageUrl('https://i.giphy.com/xyz123.gif'), true);

  // Non-images
  assert.equal(isImageUrl('https://www.ptt.cc/bbs/Gossiping/index.html'), false);
  assert.equal(isImageUrl('https://youtube.com/watch?v=12345'), false);
  assert.equal(isImageUrl(''), false);
  assert.equal(isImageUrl(null), false);
});

test('normalizeImageUrl upgrades and normalizes image sources', () => {
  // HTTP to HTTPS
  assert.equal(normalizeImageUrl('http://example.com/cat.jpg'), 'https://example.com/cat.jpg');

  // Twitter :large / :orig suffix
  assert.equal(
    normalizeImageUrl('https://pbs.twimg.com/media/F9abcdef:large'),
    'https://pbs.twimg.com/media/F9abcdef?format=jpg&name=large'
  );
  assert.equal(
    normalizeImageUrl('https://pbs.twimg.com/media/F9abcdef:orig'),
    'https://pbs.twimg.com/media/F9abcdef?format=jpg&name=orig'
  );

  // Imgur page to direct CDN
  assert.equal(normalizeImageUrl('https://imgur.com/aBc123X'), 'https://i.imgur.com/aBc123X.jpg');
  assert.equal(normalizeImageUrl('https://imgur.com/gallery/aBc123X'), 'https://i.imgur.com/aBc123X.jpg');
  assert.equal(normalizeImageUrl('https://m.imgur.com/aBc123X'), 'https://i.imgur.com/aBc123X.jpg');

  // Direct image URLs keep their original format/extension
  assert.equal(normalizeImageUrl('https://i.imgur.com/aBc123X.png'), 'https://i.imgur.com/aBc123X.png');
});

test('getProxiedImageUrl wraps external image URLs with weserv proxy', () => {
  const target = 'https://example.com/protected-image.jpg';
  const proxied = getProxiedImageUrl(target);
  assert.equal(proxied, `https://images.weserv.nl/?url=${encodeURIComponent(target)}&default=1`);

  // Avoids double-proxying
  assert.equal(getProxiedImageUrl(proxied), proxied);

  // Data URIs and Blob URIs remain untouched
  assert.equal(getProxiedImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='), 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  assert.equal(getProxiedImageUrl('blob:https://example.com/uuid'), 'blob:https://example.com/uuid');

  // Empty or invalid input
  assert.equal(getProxiedImageUrl(''), '');
  assert.equal(getProxiedImageUrl(null), '');
});
