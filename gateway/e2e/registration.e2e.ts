import { test, expect } from '@playwright/test'

test.describe('Registration & Login', () => {
  test('user can register and login', async ({ page }) => {
    await page.goto('/register')
    await page.fill('[name="email"]', `test-${Date.now()}@example.com`)
    await page.fill('[name="password"]', 'password123')
    await page.fill('[name="name"]', 'Test User')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
    await page.fill('[name="email"]', `test-${Date.now()}@example.com`)
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/projects/, { timeout: 10000 })
  })
})
