import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bug, X, AlertTriangle, Target, Clock, TrendingUp } from "lucide-react";
import { getRenderableMediaUrl } from "@/lib/mediaUrl";

export default function PestResult({ result, onStartOver }) {
  const getSeverityColor = (severity) => {
    if (severity === "low") return "bg-green-100 text-green-800";
    if (severity === "moderate") return "bg-yellow-100 text-yellow-800";
    if (severity === "high") return "bg-orange-100 text-orange-800";
    return "bg-red-100 text-red-800";
  };

  const imageUrl = getRenderableMediaUrl(result.image_url);

  const getTypeColor = (type) => {
    const colors = {
      insect_pest: "bg-orange-100 text-orange-800",
      fungal_disease: "bg-purple-100 text-purple-800",
      bacterial_disease: "bg-blue-100 text-blue-800",
      viral_disease: "bg-red-100 text-red-800",
      mite: "bg-pink-100 text-pink-800",
      nematode: "bg-indigo-100 text-indigo-800",
      other: "bg-gray-100 text-gray-800"
    };
    return colors[type] || "bg-gray-100 text-gray-800";
  };

  return (
    <Card className="border-none shadow-lg overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-violet-50/70 p-4">
          <h2 className="text-xl font-bold text-gray-900">Identification Result</h2>
          {onStartOver && (
            <Button variant="ghost" size="sm" onClick={onStartOver} className="gap-1 text-gray-600">
              <X className="w-4 h-4" />
              Start Over
            </Button>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Image */}
          {imageUrl && (
            <div className="rounded-lg overflow-hidden border">
              <img
                src={imageUrl}
                alt={result.pest_or_disease_name}
                className="w-full h-64 object-cover"
              />
            </div>
          )}

          {/* Identification */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-gray-600">
              <Bug className="w-5 h-5 text-violet-600" />
              <span className="font-medium">Identified As</span>
            </div>
            <p className="text-xl font-bold text-gray-900 ml-7">{result.pest_or_disease_name}</p>
            <p className="text-sm text-gray-600 ml-7 italic">{result.scientific_name}</p>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge className={getTypeColor(result.type)}>
              {result.type.replace(/_/g, ' ')}
            </Badge>
            <Badge className={getSeverityColor(result.severity)}>
              {result.severity} severity
            </Badge>
            <Badge variant="outline">
              {result.confidence_score}% confident
            </Badge>
          </div>

          {/* Damage Description */}
          {result.damage_description && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-600">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <span className="font-medium">Damage Pattern</span>
              </div>
              <p className="text-gray-700 ml-7">{result.damage_description}</p>
            </div>
          )}

          {/* Key Features */}
          {result.key_features && result.key_features.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-600">
                <Target className="w-5 h-5 text-violet-600" />
                <span className="font-medium">Key Identifying Features</span>
              </div>
              <ul className="ml-7 space-y-1">
                {result.key_features.map((feature, i) => (
                  <li key={i} className="text-gray-700 flex items-start gap-2">
                    <span className="text-violet-600">•</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Lifecycle Stage */}
          {result.lifecycle_stage && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-5 h-5 text-violet-600" />
                <span className="font-medium">Life Cycle Stage</span>
              </div>
              <p className="text-gray-700 ml-7">{result.lifecycle_stage}</p>
            </div>
          )}

          {/* Affected Plants */}
          {result.affected_plants && result.affected_plants.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-600">
                <Bug className="w-5 h-5 text-violet-600" />
                <span className="font-medium">Commonly Affects</span>
              </div>
              <p className="text-gray-700 ml-7">{result.affected_plants.join(', ')}</p>
            </div>
          )}

          {/* Spread Rate */}
          {result.spread_rate && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-gray-600">
                <TrendingUp className="w-5 h-5 text-red-600" />
                <span className="font-medium">Spread Rate</span>
              </div>
              <p className="text-gray-700 ml-7">{result.spread_rate}</p>
            </div>
          )}

          {/* Economic Impact */}
          {result.economic_impact && (
            <div className="border-t pt-4">
              <h4 className="font-semibold text-gray-900 mb-1">Economic Impact</h4>
              <p className="text-sm text-gray-700">{result.economic_impact}</p>
            </div>
          )}

          {/* Seasonal Activity */}
          {result.seasonal_activity && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Seasonal Activity</h4>
              <p className="text-sm text-gray-700">{result.seasonal_activity}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

