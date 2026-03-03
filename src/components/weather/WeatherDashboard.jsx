import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudRain, Wind, Droplets, Thermometer, AlertTriangle, RefreshCw, Loader2, Sun, Cloud, CloudDrizzle, CloudSnow, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getBrowserLocation } from "@/lib/browserLocation";

export default function WeatherDashboard({ compact = false, className = "" }) {
  const [weatherData, setWeatherData] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [locationSource, setLocationSource] = useState("default");

  const fetchWeather = async ({ forceRefreshLocation = false } = {}) => {
    setIsLoading(true);
    try {
      const user = await appClient.auth.me();
      const profileLocation = String(user?.location || "").trim();
      const browserLocation = await getBrowserLocation({ forceRefresh: forceRefreshLocation });
      const source = browserLocation ? "gps" : profileLocation ? "profile" : "default";
      setLocationSource(source);
      const locationLabel = browserLocation
        ? `${browserLocation.latitude.toFixed(4)}, ${browserLocation.longitude.toFixed(4)}`
        : profileLocation || "Des Moines, Iowa, United States";
      const coordinateContext = browserLocation
        ? `Use these exact coordinates as primary source:
Latitude: ${browserLocation.latitude}
Longitude: ${browserLocation.longitude}`
        : `Use this location name as primary source: ${locationLabel}`;

      const result = await appClient.integrations.Core.InvokeLLM({
        prompt: `Get REAL-TIME weather data for this farm. Use current internet data sources.

Location: ${locationLabel}
${coordinateContext}

Provide:
1. Current conditions (temperature, humidity, wind speed, conditions, "feels like" temp)
2. 7-day forecast with daily high/low temps, conditions, precipitation chance, wind
3. Weather alerts/warnings (frost, heavy rain, high winds, storms, extreme heat/cold)
4. Agricultural risk assessment (optimal/caution/poor for farming activities)

Use actual real-time weather data from reliable sources.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            current: {
              type: "object",
              properties: {
                location: { type: "string" },
                temperature: { type: "number" },
                feels_like: { type: "number" },
                humidity: { type: "number" },
                wind_speed: { type: "number" },
                wind_direction: { type: "string" },
                conditions: { type: "string" },
                description: { type: "string" },
                uv_index: { type: "number" },
                pressure: { type: "number" }
              }
            },
            forecast: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  day: { type: "string" },
                  date: { type: "string" },
                  high: { type: "number" },
                  low: { type: "number" },
                  conditions: { type: "string" },
                  precipitation_chance: { type: "number" },
                  wind_speed: { type: "number" },
                  icon: { type: "string" }
                }
              }
            },
            alerts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  severity: { type: "string", enum: ["low", "moderate", "high", "critical"] },
                  message: { type: "string" },
                  action: { type: "string" }
                }
              }
            },
            farming_conditions: {
              type: "object",
              properties: {
                overall: { type: "string", enum: ["optimal", "good", "caution", "poor"] },
                irrigation_advice: { type: "string" },
                pest_risk: { type: "string" },
                task_timing: { type: "string" }
              }
            }
          }
        }
      });

      setWeatherData(result.current);
      setForecast(result.forecast || []);
      setAlerts(result.alerts || []);

      // Auto-log weather for predictions
      if (result.current) {
        await appClient.entities.WeatherLog.create({
          date: new Date().toISOString().split('T')[0],
          location: result.current.location,
          latitude: browserLocation?.latitude ?? null,
          longitude: browserLocation?.longitude ?? null,
          temperature_high: result.current.temperature,
          temperature_low: result.current.temperature - 5,
          humidity: result.current.humidity,
          rainfall: 0,
          conditions: result.current.conditions,
          wind_speed: result.current.wind_speed
        }).catch(() => {});
      }

    } catch (error) {
      console.error("Failed to fetch weather:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
  }, []);

  const getWeatherIcon = (conditions) => {
    const cond = conditions?.toLowerCase() || "";
    if (cond.includes("rain") || cond.includes("drizzle")) return CloudDrizzle;
    if (cond.includes("snow")) return CloudSnow;
    if (cond.includes("cloud")) return Cloud;
    return Sun;
  };

  const getSeverityColor = (severity) => {
    const colors = {
      low: "bg-blue-100 text-blue-800",
      moderate: "bg-yellow-100 text-yellow-800",
      high: "bg-orange-100 text-orange-800",
      critical: "bg-red-100 text-red-800"
    };
    return colors[severity] || "bg-gray-100 text-gray-800";
  };

  if (isLoading) {
    return (
      <Card className={`border-none shadow-lg rounded-3xl ${className}`.trim()}>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
          <p className="text-gray-600">Fetching real-time weather...</p>
        </CardContent>
      </Card>
    );
  }

  if (compact && weatherData) {
    const Icon = getWeatherIcon(weatherData.conditions);
    return (
      <Card className={`border-none shadow-lg overflow-hidden rounded-3xl ${className}`.trim()}>
        <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon className="w-10 h-10" />
              <div>
                <p className="text-3xl font-bold">{Math.round(weatherData.temperature)}°F</p>
                <p className="text-blue-100 text-sm">{weatherData.conditions}</p>
                {locationSource !== "gps" && (
                  <p className="text-xs text-blue-100">Using fallback location</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchWeather({ forceRefreshLocation: true })}
                className="text-white"
                title="Use my live location"
              >
                <MapPin className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={fetchWeather} className="text-white" title="Refresh weather">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
            <div className="flex items-center gap-1">
              <Droplets className="w-4 h-4" />
              {weatherData.humidity}%
            </div>
            <div className="flex items-center gap-1">
              <Wind className="w-4 h-4" />
              {weatherData.wind_speed} mph
            </div>
            <div className="flex items-center gap-1">
              <Thermometer className="w-4 h-4" />
              Feels {Math.round(weatherData.feels_like)}°F
            </div>
          </div>
        </div>
        {alerts.length > 0 && (
          <div className="p-3 border-t bg-red-50">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-semibold">{alerts.length} Active Alert{alerts.length > 1 ? 's' : ''}</span>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className={`border-none shadow-lg overflow-hidden rounded-3xl ${className}`.trim()}>
      <CardHeader className="border-b bg-violet-50/70">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CloudRain className="w-5 h-5 text-violet-600" />
            Weather Forecast
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchWeather({ forceRefreshLocation: true })}
              title="Use my live location"
            >
              <MapPin className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchWeather} title="Refresh weather">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Current Weather */}
        {weatherData && (
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-6 text-white">
            <p className="text-blue-100 mb-2">{weatherData.location}</p>
            {locationSource !== "gps" && (
              <p className="mb-2 text-xs text-blue-100">
                Live GPS not available. Showing {locationSource === "profile" ? "profile location" : "default location"}.
              </p>
            )}
            <div className="flex items-center gap-4 mb-4">
              {React.createElement(getWeatherIcon(weatherData.conditions), { className: "w-16 h-16" })}
              <div>
                <p className="text-5xl font-bold">{Math.round(weatherData.temperature)}°F</p>
                <p className="text-xl">{weatherData.conditions}</p>
                <p className="text-blue-100 text-sm">Feels like {Math.round(weatherData.feels_like)}°F</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-blue-100">Humidity</p>
                <p className="text-lg font-semibold">{weatherData.humidity}%</p>
              </div>
              <div>
                <p className="text-blue-100">Wind</p>
                <p className="text-lg font-semibold">{weatherData.wind_speed} mph</p>
              </div>
              <div>
                <p className="text-blue-100">UV Index</p>
                <p className="text-lg font-semibold">{weatherData.uv_index || 'N/A'}</p>
              </div>
              <div>
                <p className="text-blue-100">Pressure</p>
                <p className="text-lg font-semibold">{weatherData.pressure || 'N/A'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Weather Alerts */}
        {alerts.length > 0 && (
          <div className="p-6 border-b bg-red-50">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Active Weather Alerts
            </h3>
            <div className="space-y-3">
              {alerts.map((alert, idx) => (
                <div key={idx} className="border border-red-200 rounded-lg p-3 bg-white">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-gray-900">{alert.type}</p>
                    <Badge className={getSeverityColor(alert.severity)}>{alert.severity}</Badge>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{alert.message}</p>
                  {alert.action && (
                    <p className="text-sm text-violet-600 font-medium">→ {alert.action}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7-Day Forecast */}
        {forecast.length > 0 && (
          <div className="p-6">
            <h3 className="font-bold text-gray-900 mb-3">7-Day Forecast</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {forecast.map((day, idx) => {
                const Icon = getWeatherIcon(day.conditions);
                return (
                  <div key={idx} className="text-center p-3 rounded-lg border hover:bg-gray-50">
                    <p className="text-xs font-semibold text-gray-600 mb-2">{day.day}</p>
                    <Icon className="w-6 h-6 mx-auto mb-2 text-violet-600" />
                    <p className="text-sm font-bold text-gray-900">{Math.round(day.high)}°</p>
                    <p className="text-xs text-gray-500">{Math.round(day.low)}°</p>
                    {day.precipitation_chance > 0 && (
                      <p className="text-xs text-violet-600 mt-1">{day.precipitation_chance}%</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
