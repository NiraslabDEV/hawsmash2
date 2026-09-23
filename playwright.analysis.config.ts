import { defineConfig } from '@playwright/test';
import base from './playwright.orders.config';
export default defineConfig({ ...base, testMatch: 'analysis.spec.ts', outputDir: './output/playwright/analysis-results', use: { ...base.use, viewport: { width: 1440, height: 1000 } } });
