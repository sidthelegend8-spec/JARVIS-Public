/**
 * Built-in API providers. Each entry carries everything needed to make the
 * request, so connecting one only asks the user for a name and a key.
 *
 * {API_KEY} is filled from the saved key; every other {placeholder} is filled
 * by the model at call time.
 */

export interface ProviderParam {
  name: string;
  description: string;
  required: boolean;
}

export interface ApiProvider {
  id: string;
  label: string;
  /** Shown to the model, so it knows when to reach for this. */
  description: string;
  requiresKey: boolean;
  keyHint?: string;
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  params: ProviderParam[];
  resultPath?: string;
}

export const API_PROVIDERS: ApiProvider[] = [
  {
    id: 'tavily',
    label: 'Tavily — web search',
    description:
      'Searches the web and returns current results with summaries. Use for questions about recent events or anything needing live information.',
    requiresKey: true,
    keyHint: 'tvly-...',
    method: 'POST',
    url: 'https://api.tavily.com/search',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate:
      '{"api_key":"{API_KEY}","query":"{query}","search_depth":"basic","max_results":5,"include_answer":true}',
    params: [{ name: 'query', description: 'What to search the web for', required: true }],
    resultPath: 'answer'
  },
  {
    id: 'newsapi',
    label: 'NewsAPI — headlines',
    description:
      'Fetches recent news articles about a topic. Use when asked about the news or current headlines.',
    requiresKey: true,
    keyHint: '32-character key from newsapi.org',
    method: 'GET',
    url: 'https://newsapi.org/v2/everything?q={query}&pageSize=5&sortBy=publishedAt&language=en',
    headers: { 'X-Api-Key': '{API_KEY}' },
    params: [{ name: 'query', description: 'Topic to fetch news about', required: true }],
    resultPath: 'articles'
  },
  {
    id: 'openweather',
    label: 'OpenWeatherMap — weather by city',
    description:
      'Current weather conditions for a named city, in celsius. Use when asked about the weather somewhere.',
    requiresKey: true,
    keyHint: 'key from openweathermap.org',
    method: 'GET',
    url: 'https://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric',
    params: [{ name: 'city', description: 'City name, e.g. London or Tokyo', required: true }],
    resultPath: 'main'
  },
  {
    id: 'openmeteo',
    label: 'Open-Meteo — weather, no key needed',
    description:
      'Current weather for a latitude and longitude, in celsius. Use when asked about the weather at a location.',
    requiresKey: false,
    method: 'GET',
    url: 'https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true',
    params: [
      { name: 'latitude', description: 'Latitude, e.g. 33.68', required: true },
      { name: 'longitude', description: 'Longitude, e.g. -117.83', required: true }
    ],
    resultPath: 'current_weather'
  },
  {
    id: 'exchangerate',
    label: 'ExchangeRate — currency conversion, no key needed',
    description:
      'Current exchange rates for a base currency. Use when asked to convert between currencies.',
    requiresKey: false,
    method: 'GET',
    url: 'https://open.er-api.com/v6/latest/{base}',
    params: [
      { name: 'base', description: 'Three-letter base currency code, e.g. USD', required: true }
    ],
    resultPath: 'rates'
  }
];

export const findProvider = (id: string) => API_PROVIDERS.find((p) => p.id === id);

/** Safe to hand to the renderer: no request internals, no keys. */
export const publicProviders = () =>
  API_PROVIDERS.map(({ id, label, description, requiresKey, keyHint, params }) => ({
    id,
    label,
    description,
    requiresKey,
    keyHint,
    params: params.map((p) => p.name)
  }));
