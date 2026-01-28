# GitHub Pages Setup Instructions

## Enabling GitHub Pages

To enable GitHub Pages for this repository, follow these steps:

1. Go to your repository on GitHub: https://github.com/thanhtung156-blip/omcianalyzer

2. Click on **Settings** (in the repository menu)

3. In the left sidebar, click on **Pages** (under "Code and automation")

4. Under **Build and deployment**:
   - **Source**: Select "GitHub Actions"
   
5. Save the changes

## What happens next?

Once GitHub Pages is enabled:

1. The deployment workflow will automatically run when you push to the `main` branch
2. Your app will be built and deployed to: https://thanhtung156-blip.github.io/omcianalyzer/
3. The CI workflow will validate builds on every push and pull request

## Workflows Included

### CI Workflow (`.github/workflows/ci.yml`)
- Runs on: Push to main, Pull Requests to main
- Purpose: Validates that the app builds successfully
- Steps: Install dependencies → Build → Verify output

### Deploy Workflow (`.github/workflows/deploy.yml`)
- Runs on: Push to main, Manual trigger
- Purpose: Builds and deploys the app to GitHub Pages
- Steps: Install dependencies → Build → Upload artifact → Deploy to Pages

## Manual Deployment

You can also trigger a deployment manually:

1. Go to **Actions** tab in your repository
2. Select "Deploy to GitHub Pages" workflow
3. Click "Run workflow" button
4. Select the branch (main) and click "Run workflow"

## Verifying Deployment

After the workflow completes:
1. Go to the **Actions** tab to see the workflow run
2. Check the deployment URL: https://thanhtung156-blip.github.io/omcianalyzer/
3. The deployment status will be visible in the Pages settings

## Troubleshooting

If the deployment fails:
- Check the Actions tab for error messages
- Ensure GitHub Pages is enabled with "GitHub Actions" as the source
- Verify that the repository has the necessary permissions (Settings → Actions → General → Workflow permissions should allow read and write)
