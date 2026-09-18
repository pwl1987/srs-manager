import { describe, expect, it } from 'vitest';
import * as echarts from 'echarts';

describe('ECharts runtime compatibility', () => {
  it('keeps the monitor lifecycle APIs used by Monitor.jsx', () => {
    expect(echarts.version.startsWith('6.1.')).toBe(true);
    expect(typeof echarts.init).toBe('function');
    expect(typeof echarts.dispose).toBe('function');
    expect(typeof echarts.getInstanceByDom).toBe('function');
  });
});
