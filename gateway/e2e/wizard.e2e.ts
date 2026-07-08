import { test, expect } from '@playwright/test'

test.describe('Wizard Flow', () => {
  test('user can create a project through the wizard', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/projects/, { timeout: 10000 })

    await page.goto('/projects/new')
    await page.fill('[name="idea"]', 'a smart plant watering system')
    await page.click('button[type="submit"]')

    await expect(page.locator('.recommendations')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.recommendations .component-card')).toHaveCount.atLeast(1, { timeout: 10000 })
  })
})
