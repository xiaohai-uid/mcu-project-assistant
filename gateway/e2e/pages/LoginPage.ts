import { Page } from '@playwright/test'

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login')
  }

  async fillEmail(email: string) {
    await this.page.fill('[name="email"]', email)
  }

  async fillPassword(password: string) {
    await this.page.fill('[name="password"]', password)
  }

  async submit() {
    await this.page.click('button[type="submit"]')
  }

  async waitForDashboard() {
    await this.page.waitForURL(/\/projects/, { timeout: 10000 })
  }
}
