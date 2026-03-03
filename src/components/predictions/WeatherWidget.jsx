import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, RefreshCw, Thermometer, Droplets, Wind } from "lucide-react";

export default function WeatherWidget({ onWeatherData }) {
  const [weather, setWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchWeather = async (lat, lon) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await appClient.integrations.Core.InvokeLLM({
        prompt: `Get the current real-time weather data for coordinates: Latitude ${lat}, Longitude ${lon}.

Provide accurate, current weather information including:
- Current temperature in Fahrenheit
- Humidity percentage
- Wind speed in mph
- Weather conditions (sunny, cloudy, rainy, etc.)
- Location name (city, region)
- Any precipitation

Be precise and use real current data.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            location_name: { type: "string" },
            temperature: { type: "number" },
            temperature_low: { type: "number" },
            humidity: { type: "number" },
            wind_speed: { type: "number" },
            conditions: { type: "string" },
            rainfall: { type: "number" },
            description: { type: "string" },
            uv_index: { type: "number" },
            feels_like: { type: "number" }
          }
        }
      });

      setWeather(result);
      if (onWeatherData) {
        onWeatherData(result);
      }

      // Auto-save to weather log
      await appClient.entities.WeatherLog.create({
        date: new Date().toISOString().split('T')[0],
        location: result.location_name,
        temperature_high: result.temperature,
        temperature_low: result.temperature_low || result.temperature - 10,
        humidity: result.humidity,
        rainfall: result.rainfall || 0,
        conditions: result.conditions,
        wind_speed: result.wind_speed
      });

    } catch (err) {
      setError("Failed to fetch weather data");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const getLocation = () => {
    setIsLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      setIsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        fetchWeather(latitude, longitude);
      },
      () => {
        setError("Unable to get your location. Please enable location services.");
        setIsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    getLocation();
  }, []);

  const getWeatherIcon = (conditions) => {
    const cond = conditions?.toLowerCase() || '';
    if (cond.includes('rain') || cond.includes('shower')) return '🌧️';
    if (cond.includes('cloud') || cond.includes('overcast')) return '☁️';
    if (cond.includes('sun') || cond.includes('clear')) return '☀️';
    if (cond.includes('storm') || cond.includes('thunder')) return '⛈️';
    if (cond.includes('snow')) return '❄️';
    if (cond.includes('fog') || cond.includes('mist')) return '🌫️';
    return '🌤️';
  };

  if (error) {
    return (
      <Card className="border-none shadow-lg bg-gradient-to-br from-violet-500 to-purple-600">
        <CardContent className="p-6 text-white">
          <div className="text-center">
            <p className="mb-4">{error}</p>
            <Button onClick={getLocation} variant="secondary" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-none shadow-lg bg-gradient-to-br from-violet-500 to-purple-600">
        <CardContent className="p-6 text-white text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Fetching weather for your location...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg bg-gradient-to-br from-violet-500 to-purple-600 overflow-hidden">
      <CardContent className="p-6 text-white">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            <span className="font-medium">{weather?.location_name || 'Your Location'}</span>
          </div>
          <Button 
            onClick={getLocation} 
            variant="ghost" 
            size="icon"
            className="text-white hover:bg-white/20"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <span className="text-6xl">{getWeatherIcon(weather?.conditions)}</span>
          <div>
            <div className="text-5xl font-bold">{Math.round(weather?.temperature || 0)}°F</div>
            <div className="text-violet-100 capitalize">{weather?.conditions}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/20 rounded-lg p-3 text-center backdrop-blur-sm">
            <Droplets className="w-5 h-5 mx-auto mb-1" />
            <div className="text-lg font-bold">{weather?.humidity || 0}%</div>
            <div className="text-xs text-violet-100">Humidity</div>
          </div>
          <div className="bg-white/20 rounded-lg p-3 text-center backdrop-blur-sm">
            <Wind className="w-5 h-5 mx-auto mb-1" />
            <div className="text-lg font-bold">{weather?.wind_speed || 0}</div>
            <div className="text-xs text-violet-100">Wind mph</div>
          </div>
          <div className="bg-white/20 rounded-lg p-3 text-center backdrop-blur-sm">
            <Thermometer className="w-5 h-5 mx-auto mb-1" />
            <div className="text-lg font-bold">{Math.round(weather?.feels_like || weather?.temperature || 0)}°</div>
            <div className="text-xs text-violet-100">Feels Like</div>
          </div>
        </div>

        {weather?.description && (
          <p className="mt-4 rounded-lg bg-white/10 p-3 text-sm text-violet-100">
            {weather.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
