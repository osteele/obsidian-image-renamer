# Development Guide

## Building from Source

```bash
# Clone the repository
git clone https://github.com/osteele/obsidian-image-renamer.git
cd obsidian-image-renamer

# Install dependencies
bun install

# Build for development (with watch mode)
bun run dev

# Build for production
bun run build
```

## Project Structure

- `main.ts` - Main plugin file with core functionality
- `manifest.json` - Plugin metadata
- `esbuild.config.mjs` - Build configuration
- `package.json` - Dependencies and scripts
- `biome.json` - Code formatting and linting config
- `tsconfig.json` - TypeScript configuration
- `CLAUDE.md` - Development documentation for Claude AI
- `README.md` - User documentation

## Development Workflow

1. Make changes to `main.ts`
2. Run `bun run dev` for watch mode
3. Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/obsidian-image-renamer/` folder
4. Reload Obsidian (Cmd+R or Ctrl+R) to test changes

### Using Symlinks for Development

To avoid manual copying during development, you can create symlinks:

```bash
# Create plugin directory if it doesn't exist
mkdir -p ~/Obsidian/YourVault/.obsidian/plugins/obsidian-image-renamer

# Create symlinks
ln -sf $(pwd)/main.js ~/Obsidian/YourVault/.obsidian/plugins/obsidian-image-renamer/main.js
ln -sf $(pwd)/manifest.json ~/Obsidian/YourVault/.obsidian/plugins/obsidian-image-renamer/manifest.json
```

## Technical Details

### AI SDK Integration

The plugin uses the [Vercel AI SDK](https://sdk.vercel.ai/) for seamless integration with multiple AI providers including OpenAI and Ollama. This provides a unified interface for all vision models with built-in retry logic, schema validation, and error handling.

### Dependencies
- `obsidian` - The Obsidian API
- `esbuild` - Build tool for bundling TypeScript
- `@biomejs/biome` - Code formatting and linting
- `typescript` - Type checking

### Build System
- Uses esbuild to bundle TypeScript into a single JavaScript file
- Targets ES2018 for compatibility with Obsidian
- External dependencies (Obsidian API) are not bundled
- Source maps are generated for debugging

### API Integration
- Supports OpenAI's vision API by default
- Can be configured for any compatible API endpoint
- Images are resized to max 512px before sending to API to reduce token usage
- Uses JPEG compression at 80% quality for API calls
- Implements exponential backoff for retry logic
- 30-second timeout (configurable) for API requests

## Testing

To test the plugin:

1. Build the plugin: `bun run build`
2. Copy files to a test vault's plugins folder
3. Enable the plugin in Obsidian settings
4. Configure API key in plugin settings
5. Test the features:
   - Right-click an image file in the file explorer
   - Right-click an inline image in a note
   - Open an image and use the command palette

## Code Quality

Run these commands to maintain code quality:

```bash
# Format code
bun run format

# Check for linting issues
bun run lint

# Type checking
bun run typecheck
```

## Debugging

1. Open Obsidian Developer Tools: `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. Check the console for error messages
3. Use `console.log()` statements in the code for debugging
4. Source maps are included for easier debugging

## Release Process

1. Update version in `manifest.json` and `package.json`
2. Update CHANGELOG if you have one
3. Build the production version: `bun run build`
4. Create a new GitHub release
5. Upload `main.js`, `manifest.json`, and `styles.css` (if applicable) as release assets

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure code passes formatting and linting checks
5. Test thoroughly in Obsidian
6. Submit a pull request

## Common Issues

### Plugin not appearing in Obsidian
- Ensure the plugin files are in the correct folder
- Check that Obsidian is in developer mode (Settings → Community plugins → Turn on community plugins)
- Reload Obsidian

### Build errors
- Ensure you're using `bun` (not npm or yarn)
- Try deleting `node_modules` and running `bun install` again
- Check that you have the latest version of bun

### API errors during testing
- Verify your API key is valid
- Check that you have billing enabled for vision API access
- Ensure your API endpoint URL is correct