import { test, expect } from '@playwright/test'

test.describe('Export Flow', () => {
  test('user can export schematic', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')

    await page.goto('/projects/1/export')
    await expect(page.locator('text=Export')).toBeVisible({ timeout: 10000 })
    await page.click('text=Schematic')
    await expect(page.locator('svg, .schematic-preview')).toBeVisible({ timeout: 10000 })
  })

  test('invalid inputs show error gracefully', async ({ page }) => {
    await page.goto('/projects/new')
    await page.click('button[type="submit"]')
    await expect(page.locator('.error-message, [role="alert"]')).toBeVisible({ timeout: 5000 })
  })
})
