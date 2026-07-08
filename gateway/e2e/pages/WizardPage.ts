import { Page } from '@playwright/test'

export class WizardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/projects/new')
  }

  async enterIdea(text: string) {
    await this.page.fill('[name="idea"]', text)
  }

  async submit() {
    await this.page.click('button[type="submit"]')
  }

  async waitForRequirement() {
    await this.page.waitForSelector('.recommendations', { timeout: 15000 })
  }

  async waitForRecommendations() {
    await this.page.waitForSelector('.recommendations .component-card', { timeout: 10000 })
  }
}
