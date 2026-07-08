import { Page } from '@playwright/test'

export class ProjectPage {
  constructor(private page: Page) {}

  async goto(id: string) {
    await this.page.goto(`/projects/${id}`)
  }

  async clickExport() {
    await this.page.click('text=Export')
  }

  async clickSchematic() {
    await this.page.click('text=Schematic')
  }

  async waitForSvgPreview() {
    await this.page.waitForSelector('svg, .schematic-preview', { timeout: 10000 })
  }
}
