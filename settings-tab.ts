import { type App, PluginSettingTab, Setting, Notice } from 'obsidian';

// Type definitions for API responses
interface OpenAIModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
}

interface OpenAIModelsResponse {
	data: OpenAIModel[];
}

interface OllamaModel {
	name: string;
	modified_at: string;
	size: number;
}

interface OllamaModelsResponse {
	models: OllamaModel[];
}

// Import the presets from main
const LOCAL_MODEL_PRESETS = {
	ollama: {
		endpoint: 'http://localhost:11434/api/chat',
		model: 'llama3.2-vision:11b',
		name: 'Ollama'
	},
	'lm-studio': {
		endpoint: 'http://localhost:1234/v1/chat/completions',
		model: 'local-model',
		name: 'LM Studio'
	},
	localai: {
		endpoint: 'http://localhost:8080/v1/chat/completions',
		model: 'llava-1.5-7b-hf',
		name: 'LocalAI'
	},
	custom: {
		endpoint: '',
		model: '',
		name: 'Custom'
	}
};

// Define minimal interface to avoid circular dependency at type level
interface ImageRenamerPluginInterface {
	settings: {
		apiKey: string;
		localApiKey: string;
		apiEndpoint: string;
		localApiEndpoint: string;
		model: string;
		localModel: string;
		maxImageSize: number;
		datePrefix: boolean;
		caseStyle: 'lower' | 'upper' | 'title' | 'sentence' | 'preserve';
		allowSpaces: boolean;
		maxRetries: number;
		timeoutMs: number;
		useLocalModel: boolean;
		localModelServer: 'ollama' | 'lm-studio' | 'localai' | 'custom';
	};
	saveSettings(): Promise<void>;
}

export class SettingsTab extends PluginSettingTab {
	plugin: ImageRenamerPluginInterface;

	constructor(app: App, plugin: ImageRenamerPluginInterface) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Image Renamer Settings' });

		// Create tabs container
		const tabsContainer = containerEl.createDiv('settings-tabs');
		const tabsHeader = tabsContainer.createDiv('tabs-header');
		const tabsContent = tabsContainer.createDiv('tabs-content');

		// Style the tabs
		tabsHeader.style.display = 'flex';
		tabsHeader.style.borderBottom = '1px solid var(--background-modifier-border)';
		tabsHeader.style.marginBottom = '20px';

		// Create tab buttons
		const cloudTab = tabsHeader.createEl('button', { 
			text: 'Cloud Model',
			cls: 'tab-button'
		});
		const localTab = tabsHeader.createEl('button', { 
			text: 'Local Model',
			cls: 'tab-button'
		});

		// Style tab buttons
		[cloudTab, localTab].forEach(tab => {
			tab.style.padding = '10px 20px';
			tab.style.background = 'none';
			tab.style.border = 'none';
			tab.style.borderBottom = '2px solid transparent';
			tab.style.cursor = 'pointer';
			tab.style.fontSize = '14px';
		});

		// Set active tab styling
		const setActiveTab = (activeTab: HTMLElement, inactiveTab: HTMLElement, isLocal: boolean) => {
			activeTab.style.borderBottom = '2px solid var(--interactive-accent)';
			activeTab.style.color = 'var(--text-normal)';
			inactiveTab.style.borderBottom = '2px solid transparent';
			inactiveTab.style.color = 'var(--text-muted)';
			
			this.plugin.settings.useLocalModel = isLocal;
			this.plugin.saveSettings();
			
			// Clear and redraw content
			tabsContent.empty();
			if (isLocal) {
				this.displayLocalSettings(tabsContent);
			} else {
				this.displayCloudSettings(tabsContent);
			}
		};

		// Set initial active tab
		if (this.plugin.settings.useLocalModel) {
			setActiveTab(localTab, cloudTab, true);
		} else {
			setActiveTab(cloudTab, localTab, false);
		}

		// Tab click handlers
		cloudTab.addEventListener('click', () => setActiveTab(cloudTab, localTab, false));
		localTab.addEventListener('click', () => setActiveTab(localTab, cloudTab, true));

		// Common settings
		this.displayCommonSettings(containerEl);

		// Reset button at the bottom
		this.displayResetButton(containerEl);
	}

	displayCloudSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Cloud API Settings' });

		// API Key
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your OpenAI API key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					if (!this.plugin.settings.apiKey) {
						new Notice('Please enter an API key first');
						return;
					}
					
					button.setDisabled(true);
					button.setButtonText('Testing...');
					
					try {
						const response = await fetch('https://api.openai.com/v1/models', {
							headers: { 'Authorization': `Bearer ${this.plugin.settings.apiKey}` }
						});
						
						if (response.ok) {
							new Notice('✅ API key is valid!');
						} else if (response.status === 401) {
							new Notice('❌ Invalid API key');
						} else {
							new Notice(`❌ Error: ${response.status}`);
						}
					} catch (_error) {
						new Notice('❌ Failed to connect to API');
					} finally {
						button.setDisabled(false);
						button.setButtonText('Test');
					}
				}));

		// API Endpoint
		new Setting(containerEl)
			.setName('API Endpoint')
			.setDesc('The API endpoint for the vision model')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1/chat/completions')
				.setValue(this.plugin.settings.apiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.apiEndpoint = value;
					await this.plugin.saveSettings();
				}));

		// Model dropdown with fetched models
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('The model to use for caption generation');

		if (this.plugin.settings.apiKey) {
			modelSetting.addDropdown(dropdown => {
				// Add common models first
				const commonModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
				commonModels.forEach(model => {
					dropdown.addOption(model, model);
				});
				
				dropdown.setValue(this.plugin.settings.model);
				dropdown.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});

				// Try to fetch available models asynchronously
				(async () => {
					try {
						const baseURL = this.plugin.settings.apiEndpoint.replace(/\/chat\/completions$/, '');
						const response = await fetch(`${baseURL}/v1/models`, {
							headers: { 'Authorization': `Bearer ${this.plugin.settings.apiKey}` }
						});
						
						if (response.ok) {
							const data = await response.json() as OpenAIModelsResponse;
							if (data.data && Array.isArray(data.data)) {
								dropdown.selectEl.empty();
								data.data
									.filter((m) => m.id.includes('vision') || m.id.includes('gpt-4'))
									.forEach((m) => {
										dropdown.addOption(m.id, m.id);
									});
								dropdown.setValue(this.plugin.settings.model);
							}
						}
					} catch (error) {
						console.error('Failed to fetch models:', error);
					}
				})();

				return dropdown;
			});
		} else {
			modelSetting.addText(text => text
				.setPlaceholder('gpt-4o-mini')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
		}
	}

	displayLocalSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Local Model Settings' });

		// Server selection
		const serverSetting = new Setting(containerEl)
			.setName('Local Model Server')
			.setDesc('Select your local model server')
			.addDropdown(dropdown => dropdown
				.addOption('ollama', 'Ollama (port 11434)')
				.addOption('lm-studio', 'LM Studio (port 1234)')
				.addOption('localai', 'LocalAI (port 8080)')
				.addOption('custom', 'Custom')
				.setValue(this.plugin.settings.localModelServer)
				.onChange(async (value) => {
					this.plugin.settings.localModelServer = value;
					
					if (value !== 'custom') {
						const preset = LOCAL_MODEL_PRESETS[value as keyof typeof LOCAL_MODEL_PRESETS];
						this.plugin.settings.localApiEndpoint = preset.endpoint;
						this.plugin.settings.localModel = preset.model;
					}
					
					await this.plugin.saveSettings();
					this.display();
				}));

		// Test button
		serverSetting.addButton(button => button
			.setButtonText('Test')
			.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText('Testing...');
				
				const endpoint = this.plugin.settings.localModelServer !== 'custom'
					? LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer as keyof typeof LOCAL_MODEL_PRESETS].endpoint
					: this.plugin.settings.localApiEndpoint;
				
				try {
					// Try to fetch models
					const baseUrl = endpoint.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
					let testUrl = baseUrl;
					
					if (this.plugin.settings.localModelServer === 'ollama') {
						testUrl = `${baseUrl}/api/tags`;
					} else {
						testUrl = `${baseUrl}/models`;
					}
					
					const response = await fetch(testUrl);
					
					if (response.ok) {
						const data = await response.json();
						let modelCount = 0;
						
						if (this.plugin.settings.localModelServer === 'ollama' && 'models' in data) {
							const ollamaData = data as OllamaModelsResponse;
							modelCount = ollamaData.models.filter((m) => 
								m.name.includes('vision') || m.name.includes('llava')
							).length;
						} else if ('data' in data) {
							const openAIData = data as OpenAIModelsResponse;
							modelCount = openAIData.data.length;
						}
						
						if (modelCount > 0) {
							new Notice(`✅ Connected! Found ${modelCount} vision models`);
							// Refresh to show models dropdown
							this.display();
						} else {
							new Notice('✅ Server connected!');
						}
					} else {
						new Notice(`⚠️ Server responded with status ${response.status}`);
					}
				} catch (_error) {
					new Notice('❌ Cannot connect to local server');
				} finally {
					button.setDisabled(false);
					button.setButtonText('Test');
				}
			}));

		// Custom endpoint if needed
		if (this.plugin.settings.localModelServer === 'custom') {
			new Setting(containerEl)
				.setName('API Endpoint')
				.setDesc('Custom local server endpoint')
				.addText(text => text
					.setPlaceholder('http://localhost:8080/v1/chat/completions')
					.setValue(this.plugin.settings.localApiEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.localApiEndpoint = value;
						await this.plugin.saveSettings();
					}));
		}

		// Model selection with dropdown for known servers
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('The local model to use');

		if (this.plugin.settings.localModelServer !== 'custom') {
			modelSetting.addDropdown(dropdown => {
				// Add current model
				dropdown.addOption(this.plugin.settings.localModel, this.plugin.settings.localModel);
				dropdown.setValue(this.plugin.settings.localModel);
				
				dropdown.onChange(async (value) => {
					this.plugin.settings.localModel = value;
					await this.plugin.saveSettings();
				});

				// Try to fetch available models asynchronously
				(async () => {
					try {
						const endpoint = LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer as keyof typeof LOCAL_MODEL_PRESETS].endpoint;
						const baseUrl = endpoint.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
						
						if (this.plugin.settings.localModelServer === 'ollama') {
							const response = await fetch(`${baseUrl}/api/tags`);
							if (response.ok) {
								const data = await response.json() as OllamaModelsResponse;
								if (data.models) {
									dropdown.selectEl.empty();
									data.models
										.filter((m) => m.name.includes('vision') || m.name.includes('llava'))
										.forEach((m) => {
											dropdown.addOption(m.name, m.name);
										});
									dropdown.setValue(this.plugin.settings.localModel);
								}
							}
						}
					} catch (error) {
						console.error('Failed to fetch local models:', error);
					}
				})();

				return dropdown;
			});
		} else {
			modelSetting.addText(text => text
				.setPlaceholder('llava')
				.setValue(this.plugin.settings.localModel)
				.onChange(async (value) => {
					this.plugin.settings.localModel = value;
					await this.plugin.saveSettings();
				}));
		}
	}

	displayCommonSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'File Naming Settings' });

		new Setting(containerEl)
			.setName('Case Style')
			.setDesc('How to handle letter casing in filenames')
			.addDropdown(dropdown => dropdown
				.addOption('preserve', 'Preserve original')
				.addOption('lower', 'lowercase')
				.addOption('upper', 'UPPERCASE')
				.addOption('title', 'Title Case')
				.addOption('sentence', 'Sentence case')
				.setValue(this.plugin.settings.caseStyle)
				.onChange(async (value) => {
					this.plugin.settings.caseStyle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date Prefix')
			.setDesc('Add date prefix to renamed files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.datePrefix)
				.onChange(async (value) => {
					this.plugin.settings.datePrefix = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Allow Spaces')
			.setDesc('Allow spaces in filenames')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.allowSpaces)
				.onChange(async (value) => {
					this.plugin.settings.allowSpaces = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Advanced Settings' });

		new Setting(containerEl)
			.setName('Request Timeout')
			.setDesc('Timeout in seconds (default: 30)')
			.addText(text => text
				.setPlaceholder('30')
				.setValue(String(this.plugin.settings.timeoutMs / 1000))
				.onChange(async (value) => {
					const seconds = parseInt(value, 10) || 30;
					this.plugin.settings.timeoutMs = seconds * 1000;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max Retries')
			.setDesc('Maximum retry attempts (default: 3)')
			.addText(text => text
				.setPlaceholder('3')
				.setValue(String(this.plugin.settings.maxRetries))
				.onChange(async (value) => {
					this.plugin.settings.maxRetries = parseInt(value, 10) || 3;
					await this.plugin.saveSettings();
				}));

		// Reset API Settings button
		new Setting(containerEl)
			.setName('Reset API Settings')
			.setDesc('Reset all API-related settings to defaults (clears API keys)')
			.addButton(button => button
				.setButtonText('Reset API Settings')
				.onClick(async () => {
					if (confirm('Reset all API settings to defaults? Your API keys will be cleared.')) {
						// Reset API-related settings
						this.plugin.settings.apiKey = '';
						this.plugin.settings.localApiKey = '';
						this.plugin.settings.apiEndpoint = 'https://api.openai.com/v1/chat/completions';
						this.plugin.settings.localApiEndpoint = 'http://localhost:11434/api/chat';
						this.plugin.settings.model = 'gpt-4o-mini';
						this.plugin.settings.localModel = 'llama3.2-vision:11b';
						this.plugin.settings.localModelServer = 'ollama';
						await this.plugin.saveSettings();
						new Notice('✅ API settings reset to defaults');
						this.display();
					}
				}));

		// Reset File Name Settings button
		new Setting(containerEl)
			.setName('Reset File Name Settings')
			.setDesc('Reset file naming preferences to defaults')
			.addButton(button => button
				.setButtonText('Reset File Name Settings')
				.onClick(async () => {
					if (confirm('Reset file naming settings to defaults?')) {
						// Reset file naming settings
						this.plugin.settings.datePrefix = false;
						this.plugin.settings.caseStyle = 'title';
						this.plugin.settings.allowSpaces = true;
						await this.plugin.saveSettings();
						new Notice('✅ File naming settings reset to defaults');
						this.display();
					}
				}));
	}

	displayResetButton(containerEl: HTMLElement) {
		const resetContainer = containerEl.createEl('div', {
			attr: { style: 'padding: 10px; background: var(--background-modifier-form-field); border-radius: 5px;' }
		});
		
		resetContainer.createEl('p', { 
			text: 'Reset all settings to defaults if they appear corrupted.',
			cls: 'setting-item-description'
		});
		
		const resetButton = resetContainer.createEl('button', {
			text: '🔄 Reset All Settings to Defaults',
			cls: 'mod-warning'
		});
		
		resetButton.addEventListener('click', async () => {
			if (confirm('Reset ALL settings to defaults? Your API key will be cleared.')) {
				// Reset to defaults - we'll need to import DEFAULT_SETTINGS
				const DEFAULT_SETTINGS = {
					apiKey: '',
					localApiKey: '',
					apiEndpoint: 'https://api.openai.com/v1/chat/completions',
					localApiEndpoint: 'http://localhost:11434/api/chat',
					model: 'gpt-4o-mini',
					localModel: 'llama3.2-vision:11b',
					maxImageSize: 1024,
					datePrefix: false,
					caseStyle: 'title' as const,
					allowSpaces: true,
					maxRetries: 3,
					timeoutMs: 30000,
					useLocalModel: false,
					localModelServer: 'ollama'
				};
				
				this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
				await this.plugin.saveSettings();
				new Notice('✅ Settings reset to defaults');
				this.display();
			}
		});
	}
}