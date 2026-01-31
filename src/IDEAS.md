# Ideas

Future enhancements and brainstorming for vex.

## Loop Command Phases

### Phase 2: Interactive Mode

Implement real `promptHuman` callback with CLI selection:

- Use `@inquirer/prompts` or `@clack/prompts` for terminal UI
- Present detected issues with code locations
- Options: apply, skip, modify, abort
- Allow user to pick alternative location from candidates
- Show diff preview before applying

### Phase 3: Apply Mode

Implement real `applyFix` callback behind `--apply` flag:

- `--apply` enables code modifications (default: dry-run behavior)
- `--scope css|liquid|all` to restrict fix targets
- Generate diffs and stage for review
- Git integration: create fixup commits per iteration
- Rollback support if verification shows regression

## Pipeline Enhancements

### Parallel Viewport Capture

- Run multiple viewports concurrently
- Aggregate issues across viewports
- Responsive regression detection

### Incremental Analysis

- Cache DOM fingerprints to detect unchanged regions
- Skip re-analyzing stable areas
- Focus VLM attention on changed content

### Visual Diff Comparison

- Pixel-diff between iterations
- Highlight regions that changed after fix
- Overlay before/after in single annotated image

## Locator Improvements

### Source Map Support

- Parse CSS/SCSS source maps
- Map minified selectors back to original files
- Support Liquid → compiled CSS tracing

### AST-Based Location

- Parse Liquid AST to find template blocks
- Identify component boundaries
- Map DOM elements to Liquid partials

### Semantic Matching

- Use embeddings to match issue descriptions to code comments
- Find related code even without exact selector match
- Suggest fixes based on similar historical issues

## Provider Enhancements

### Multi-Provider Consensus

- Run same image through multiple VLMs
- Aggregate findings with confidence boost for agreement
- Flag conflicting assessments for human review

### Fine-Tuned Models

- Train specialized model on Shopify theme patterns
- Lower latency than general-purpose VLMs
- Better understanding of Liquid template structure

## CLI/UX Ideas

### Watch Mode

- `vex loop --watch` monitors file changes
- Re-run analysis on save
- Hot-reload preview in browser

### Report Generation

- `vex report <session>` generates HTML report
- Annotated screenshots with issue callouts
- Code snippets with suggested fixes
- Export to PDF for stakeholder review

### CI Integration

- `vex ci <url>` for GitHub Actions / CI pipelines
- Exit code based on issue severity threshold
- Comment on PR with visual diff

### Browser Extension

- Overlay vex annotations directly in Chrome DevTools
- Click issue to jump to code location
- Real-time analysis as you browse

## Architecture Ideas

### Plugin System

- Allow custom operations via plugin interface
- Community-contributed locator strategies
- Provider adapters for new VLMs

### Remote Execution

- `vex daemon` for persistent browser instance
- Faster iteration with warm browser
- Share session across team members

### Shopify Theme Check Integration

- Combine visual issues with theme-check linting
- Unified issue view across static and visual analysis
- Auto-fix coordination between tools
