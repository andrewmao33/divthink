import type { ModelInfo } from './api'

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Claude', google: 'Gemini' }

// The <option>s for a model picker: only models whose provider has a saved key,
// grouped by provider when there is more than one.
function ModelOptions({ models }: { models: ModelInfo[] }) {
  const usable = models.filter((m) => m.available)
  const providers = [...new Set(usable.map((m) => m.provider))]
  const options = (provider: string) =>
    usable
      .filter((m) => m.provider === provider)
      .map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))
  if (providers.length === 1) return <>{options(providers[0])}</>
  return (
    <>
      {providers.map((provider) => (
        <optgroup key={provider} label={PROVIDER_NAMES[provider] ?? provider}>
          {options(provider)}
        </optgroup>
      ))}
    </>
  )
}

export default ModelOptions
