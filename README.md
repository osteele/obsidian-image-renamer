# Obsidian Image Renamer

[![GitHub release](https://img.shields.io/github/v/release/osteele/obsidian-image-renamer)](https://github.com/osteele/obsidian-image-renamer/releases)
[![License](https://img.shields.io/github/license/osteele/obsidian-image-renamer)](LICENSE)

An Obsidian plugin that uses AI vision models to automatically generate meaningful names for image files.

<img src="./docs/screenshot.png" alt="Obsidian Image Renamer in action" style="max-width: 600px;">

## Features

- **AI-Powered Captions**: Uses vision models (like GPT-4 Vision) to analyze images and generate descriptive filenames
- **Interactive Mode**: Choose from multiple AI-generated suggestions or create your own custom name
- **Automatic Mode**: Quickly rename files with the best AI-generated caption
- **Smart Renaming**: Uses the Obsidian rename function, so that all references to the renamed file are updated throughout the vault
- **Customizable Formatting**:
  - Date prefixes (YYYY-MM-DD format)
  - Case styles (lowercase, UPPERCASE, Title Case, Sentence case)
  - Space handling (spaces or hyphens)

## Installation

### Manual Installation

1. Download the latest release from the GitHub releases page
2. Extract the files to your vault's `.obsidian/plugins/obsidian-image-renamer` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

### From Community Plugins

(Pending approval)

## Usage

### Commands

The plugin adds two commands to Obsidian:

1. **Rename image file with AI caption**: Automatically renames the current image file with the first AI-generated suggestion
2. **Rename image file interactively**: Shows a modal with multiple caption suggestions that you can choose from or edit

### How to Use

1. **From File Explorer**: Right-click any image file and select "Rename with AI caption" or "Rename interactively..."
2. **From Inline Images**: Right-click on an image displayed inline in a note and select the rename options
3. **From Open File**: Open an image file and run commands from the Command Palette (Ctrl/Cmd + P)
4. The plugin will:
   - Send the image to your configured AI service
   - Generate caption suggestions
   - Either rename automatically or show you options to choose from
   - Update all links to the image throughout your vault

## Configuration

Configure the plugin in Settings → Plugin Options → Image Renamer:

- **API Key**: Your OpenAI API key (or compatible service)
- **API Endpoint**: The API endpoint for the vision model (defaults to OpenAI)
- **Model**: The model to use (e.g., `gpt-4o-mini`)
- **Date Prefix**: Add creation date to filenames (YYYY-MM-DD format)
- **Case Style**: How to format the filename text
- **Allow Spaces**: Use spaces in filenames (otherwise converts to hyphens)

## API Services

The plugin is designed to work with OpenAI's vision models but can be configured to work with any compatible API endpoint that accepts the same request format.

### OpenAI Setup

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Enter the key in the plugin settings
3. Use model `gpt-4o-mini` for best results

### Alternative Services

You can use any service that provides an OpenAI-compatible API by changing the API Endpoint in settings.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions and development guidelines.

## Roadmap

- [ ] Batch rename all files with generic names (Download, Image, Screenshot, or UUIDs)
- [ ] Custom prompt templates for different types of images
- [ ] Integration with local AI models
- [ ] Automatic retry with new API call when generated name already exists in vault

## Related Projects

### My Command-Line Tools
- [rename-image-files](https://github.com/osteele/rename-image-files) - CLI tool to batch rename image files using AI-generated captions. This extension was adapted from that one.
- [rename-academic-pdf](https://github.com/osteele/rename-academic-pdf) - CLI tool to rename academic PDFs based on their content and metadata

### Other Obsidian Plugins
- [Paste Image Rename](https://github.com/reorx/obsidian-paste-image-rename) - Rename images automatically when pasting into Obsidian
- [Image Converter](https://github.com/xryul/obsidian-image-converter) - Convert and compress images in your vault
- [Attachment Management](https://github.com/trganda/obsidian-attachment-management) - Comprehensive attachment organization and management

## License

MIT

## Author

Oliver Steele
