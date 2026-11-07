import { useState, useEffect } from 'react';

function getWeatherCondition(code: number) {
  if (code === 0) return 'CLEAR';
  if (code >= 1 && code <= 3) return 'CLOUDY';
  if (code >= 45 && code <= 48) return 'FOG';
  if (code >= 51 && code <= 55) return 'DRIZZLE';
  if (code >= 61 && code <= 65) return 'RAIN';
  if (code >= 71 && code <= 75) return 'SNOW';
  if (code >= 95) return 'STORM';
  return 'ACTIVE';
}

export interface HudPlace {
  label: string;
  time: string;
  temp: string;
  condition: string;
}

/**
 * The HUD's two clocks: this PC's local time (with the weather in the home city
 * from Settings, if one is set) and UTC. Open-Meteo needs no key.
 */
export function useHudData(homeCity: string) {
  const [local, setLocal] = useState<HudPlace>({ label: 'LOCAL', time: '00:00:00', temp: '--', condition: 'SET A CITY IN SETTINGS' });
  const [utc, setUtc] = useState<HudPlace>({ label: 'UTC', time: '00:00:00', temp: '', condition: 'COORDINATED UNIVERSAL TIME' });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLocal((prev) => ({ ...prev, time: now.toLocaleTimeString('en-GB', { hour12: false }) }));
      setUtc((prev) => ({ ...prev, time: now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) }));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const city = homeCity.trim();
    if (!city) {
      setLocal((prev) => ({ ...prev, label: 'LOCAL', temp: '--', condition: 'SET A CITY IN SETTINGS' }));
      return;
    }
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)).json();
        const place = geo?.results?.[0];
        if (!place) {
          if (!cancelled) setLocal((prev) => ({ ...prev, label: city.toUpperCase(), temp: '--', condition: 'CITY NOT FOUND' }));
          return;
        }
        const data = await (await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`
        )).json();
        if (!cancelled && data.current_weather) {
          setLocal((prev) => ({
            ...prev,
            label: `${String(place.name).toUpperCase()}${place.country_code ? `, ${place.country_code}` : ''}`,
            temp: `${Math.round(data.current_weather.temperature)}°C`,
            condition: getWeatherCondition(data.current_weather.weathercode)
          }));
        }
      } catch (e) {
        console.error('Weather fetch failed', e);
      }
    };
    void fetchWeather();
    const timer = setInterval(fetchWeather, 600000); // 10 minutes
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [homeCity]);

  return { local, utc };
}
