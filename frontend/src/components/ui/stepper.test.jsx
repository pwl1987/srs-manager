import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Stepper from './Stepper';

vi.hoisted(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { documentElement: { lang: '' } };
  globalThis.self = globalThis;
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
});

const STEPS = [
  { key: 'basics', label: '基本信息' },
  { key: 'direction', label: '输入方向' },
  { key: 'run', label: '预检与运行' }
];

describe('Stepper display-only navigation contract', () => {
  it('marks the current step active and bounds reachability to maxReached', () => {
    const html = renderToStaticMarkup(
      <Stepper steps={STEPS} current={1} maxReached={1} t={key => key} />
    );
    expect(html).toContain('基本信息');
    expect(html).toContain('输入方向');
    expect(html).toContain('预检与运行');
    // The current step and the unreached future step render disabled; the
    // visited step stays clickable for revisits.
    const disabledCount = (html.match(/disabled/g) || []).length;
    expect(disabledCount).toBe(2);
  });

  it('renders with the aria label from the shared action namespace', () => {
    const html = renderToStaticMarkup(
      <Stepper steps={STEPS} current={0} maxReached={0} t={key => key} />
    );
    expect(html).toContain('common:actions.steps');
  });
});
