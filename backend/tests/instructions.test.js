"use strict";
const { test } = require('node:test');
const assert = require('node:assert');
const { renderInstructions } = require('../src/instructions.js');

test('renderInstructions returns a full HTML page with the version injected', () => {
  const html = renderInstructions('1.8.1505');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Tunny — Rules</title>'));
  assert.ok(html.includes('Version 1.8.1505'));
});

test('instructions cover the game essentials', () => {
  const html = renderInstructions('x');
  assert.ok(html.includes('12 points'));
  assert.ok(html.includes('340'));
  assert.ok(html.includes('Bid vs. required HCP'));
  assert.ok(html.includes('Back to Game'));
});

test('instructions no longer describe contract levels', () => {
  const html = renderInstructions('x');
  assert.ok(!html.includes('Contract Level'));
  assert.ok(!html.includes('Tricks Needed'));
});
