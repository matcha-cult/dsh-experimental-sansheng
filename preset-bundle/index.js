/**
 * Preset bundle entry: mount the host's own agent-preset plugin so the
 * `preset-sansheng` declaration uses the host preset registry contract.
 * A relative or bare host specifier in an inserted row does not resolve for a
 * profile-installed bundle, but a dynamic import from a plugin module does.
 */
export default (await import('@deepseek-ai/dsh-agent-preset')).default
