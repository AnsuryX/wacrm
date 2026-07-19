"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Property, PropertySource, PropertyStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MapPin,
  Plus,
  Compass,
  DollarSign,
  Grid,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  Home,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export default function PropertiesPage() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Dialog State
  const [formOpen, setFormOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);

  // Form Fields
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [source, setSource] = useState<PropertySource>("Internal");
  const [status, setStatus] = useState<PropertyStatus>("Active");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [description, setDescription] = useState("");
  const [features, setFeatures] = useState("");
  const [saving, setSaving] = useState(false);

  // Map viewport simulation state
  const [viewport, setViewport] = useState({
    minLat: 25.2,
    maxLat: 25.4,
    minLng: 51.4,
    maxLng: 51.6,
  });

  // Fetch API key dynamically to authorize REST queries to our map endpoint
  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const { data } = await supabase
        .from("api_keys")
        .select("key")
        .eq("account_id", accountId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (data && (data as any).key) {
        setApiKey((data as any).key);
      }
    })();
  }, [supabase, accountId]);

  const loadProperties = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("properties")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (searchQuery.trim()) {
      query = query.ilike("address", `%${searchQuery}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to load properties:", error.message);
    } else {
      setProperties((data ?? []) as Property[]);
    }
    setLoading(false);
  }, [supabase, accountId, searchQuery]);

  const loadMapProperties = useCallback(async () => {
    setLoading(true);
    try {
      const { minLat, maxLat, minLng, maxLng } = viewport;

      // Hit our newly built REST Map endpoint
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(
        `/api/v1/properties/map?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`,
        { headers }
      );

      if (res.ok) {
        const body = await res.json();
        if (body.data) {
          setProperties(body.data as Property[]);
          setLoading(false);
          return;
        }
      }

      // Fallback direct table query if REST map API key is pending
      const { data } = await supabase
        .from("properties")
        .select("*")
        .eq("account_id", accountId)
        .not("coordinates_lat", "is", null)
        .not("coordinates_lng", "is", null)
        .gte("coordinates_lat", minLat)
        .lte("coordinates_lat", maxLat)
        .gte("coordinates_lng", minLng)
        .lte("coordinates_lng", maxLng);

      if (data) {
        setProperties(data as Property[]);
      }
    } catch (err) {
      console.error("[PropertiesPage] map load error:", err);
    }
    setLoading(false);
  }, [supabase, accountId, viewport, apiKey]);

  useEffect(() => {
    if (!accountId) return;
    if (viewMode === "list") {
      loadProperties();
    } else {
      loadMapProperties();
    }
  }, [accountId, viewMode, loadProperties, loadMapProperties]);

  const handleOpenForm = (prop?: Property) => {
    if (prop) {
      setEditingProperty(prop);
      setAddress(prop.address);
      setPrice(String(prop.price));
      setBeds(prop.beds !== null && prop.beds !== undefined ? String(prop.beds) : "");
      setBaths(prop.baths !== null && prop.baths !== undefined ? String(prop.baths) : "");
      setSource(prop.source);
      setStatus(prop.status);
      setLat(prop.coordinates_lat !== null && prop.coordinates_lat !== undefined ? String(prop.coordinates_lat) : "");
      setLng(prop.coordinates_lng !== null && prop.coordinates_lng !== undefined ? String(prop.coordinates_lng) : "");
      setDescription(prop.description || "");
      setFeatures(prop.features ? prop.features.join(", ") : "");
    } else {
      setEditingProperty(null);
      setAddress("");
      setPrice("");
      setBeds("");
      setBaths("");
      setSource("Internal");
      setStatus("Active");
      // Default to Pearl Qatar coordinates if adding new
      setLat("25.3721");
      setLng("51.5524");
      setDescription("");
      setFeatures("");
    }
    setFormOpen(true);
  };

  const handleSaveProperty = async () => {
    if (!address.trim() || !price) {
      toast.error("Address and Price are required.");
      return;
    }
    setSaving(true);

    const parsedPrice = parseFloat(price) || 0;
    const parsedBeds = parseInt(beds) || null;
    const parsedBaths = parseFloat(baths) || null;
    const parsedLat = parseFloat(lat) || null;
    const parsedLng = parseFloat(lng) || null;
    const parsedFeatures = features
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const payload = {
      address: address.trim(),
      price: parsedPrice,
      beds: parsedBeds,
      baths: parsedBaths,
      source,
      status,
      coordinates_lat: parsedLat,
      coordinates_lng: parsedLng,
      description: description.trim() || null,
      features: parsedFeatures,
      account_id: accountId,
    };

    if (editingProperty) {
      const { error } = await supabase
        .from("properties")
        .update(payload)
        .eq("id", editingProperty.id);

      if (error) {
        toast.error("Failed to update property.");
      } else {
        toast.success("Property updated.");
        setFormOpen(false);
        if (viewMode === "list") loadProperties();
        else loadMapProperties();
      }
    } else {
      const { error } = await supabase.from("properties").insert(payload);
      if (error) {
        toast.error("Failed to add property.");
      } else {
        toast.success("Property created.");
        setFormOpen(false);
        if (viewMode === "list") loadProperties();
        else loadMapProperties();
      }
    }
    setSaving(true);
  };

  const handleDeleteProperty = async (id: string) => {
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete property.");
    } else {
      toast.success("Property deleted.");
      if (viewMode === "list") loadProperties();
      else loadMapProperties();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Properties Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage US MLS & Qatari property portals and standard active listings
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle View List/Map */}
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Grid className="h-3.5 w-3.5" />
              List
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "map"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Map
            </button>
          </div>

          <Button
            onClick={() => handleOpenForm()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Property
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search address, neighborhood or property ID..."
            className="border-border bg-card pl-9 text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (viewMode === "list") loadProperties();
                else loadMapProperties();
              }
            }}
          />
        </div>
        <Button variant="outline" onClick={viewMode === "list" ? loadProperties : loadMapProperties} className="border-border bg-card">
          Refresh
        </Button>
      </div>

      {/* Main Area */}
      {loading ? (
        <div className="flex py-20 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : viewMode === "list" ? (
        properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 bg-card/50">
            <Home className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No properties found</h3>
            <p className="mt-2 text-sm text-muted-foreground">Add your first real estate listing.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {properties.map((prop) => (
              <div
                key={prop.id}
                onClick={() => handleOpenForm(prop)}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm hover:border-border hover:shadow-lg transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                    {prop.source}
                  </span>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      prop.status === "Active"
                        ? "bg-green-500/15 text-green-400"
                        : prop.status === "Pending"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {prop.status}
                  </span>
                </div>

                <h3 className="mt-3 font-semibold text-foreground text-sm line-clamp-2 h-10">
                  {prop.address}
                </h3>

                <p className="mt-2 text-lg font-bold text-primary">
                  ${prop.price.toLocaleString()}
                </p>

                <div className="mt-3 flex gap-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
                  <span>🛌 {prop.beds || 0} Beds</span>
                  <span>🛁 {prop.baths || 0} Baths</span>
                  {prop.coordinates_lat && (
                    <span className="flex items-center gap-0.5 ml-auto">
                      📍 {prop.coordinates_lat.toFixed(3)}, {prop.coordinates_lng?.toFixed(3)}
                    </span>
                  )}
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProperty(prop.id);
                  }}
                  className="absolute right-3 bottom-14 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity p-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Map View and Viewport bounding-box simulator */
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          {/* Mock Interactive Geospatial Map (using canvas/SVG coordinate projection) */}
          <div className="relative h-[550px] w-full rounded-xl border border-border bg-muted/30 overflow-hidden flex flex-col justify-end">
            <div className="absolute inset-0 p-4 select-none bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(#374151_1px,transparent_1px)]">
              {/* Virtual Doha Coastline Map representation */}
              <div className="absolute right-4 top-10 w-44 h-80 bg-blue-500/10 rounded-full blur-xl border border-blue-400/20 flex items-center justify-center text-xs text-blue-400">
                Arabian Gulf / Sea
              </div>

              {/* Rendering interactive Property Markers inside the Map area */}
              {properties
                .filter((p) => p.coordinates_lat && p.coordinates_lng)
                .map((prop) => {
                  // Project coordinate bounds into local canvas % widths
                  const latSpan = viewport.maxLat - viewport.minLat;
                  const lngSpan = viewport.maxLng - viewport.minLng;
                  const bottomPercent = ((prop.coordinates_lat! - viewport.minLat) / latSpan) * 100;
                  const leftPercent = ((prop.coordinates_lng! - viewport.minLng) / lngSpan) * 100;

                  // Out of bounds check
                  if (bottomPercent < 0 || bottomPercent > 100 || leftPercent < 0 || leftPercent > 100) {
                    return null;
                  }

                  return (
                    <button
                      key={prop.id}
                      onClick={() => handleOpenForm(prop)}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group/marker focus:outline-none"
                      style={{ bottom: `${bottomPercent}%`, left: `${leftPercent}%` }}
                    >
                      <span className="px-2 py-1 text-[10px] font-bold bg-primary text-primary-foreground rounded shadow border border-border/20 scale-90 group-hover/marker:scale-100 group-hover/marker:bg-foreground group-hover/marker:text-background transition-transform">
                        ${(prop.price / 1000).toFixed(0)}k
                      </span>
                      <MapPin className="h-5 w-5 text-primary group-hover/marker:text-foreground" />
                    </button>
                  );
                })}
            </div>

            {/* Simulated Navigation Control bar */}
            <div className="relative z-20 m-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-md backdrop-blur">
              <Compass className="h-4 w-4 text-primary animate-spin" />
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <span>Viewport Bounding Box:</span>
                <span className="text-muted-foreground font-medium">
                  Lat [{viewport.minLat.toFixed(3)} - {viewport.maxLat.toFixed(3)}]
                </span>
                <span className="text-muted-foreground font-medium">
                  Lng [{viewport.minLng.toFixed(3)} - {viewport.maxLng.toFixed(3)}]
                </span>
              </div>

              {/* Zoom Out & Pan Buttons to update viewport bounding box dynamically */}
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setViewport({
                      minLat: viewport.minLat - 0.05,
                      maxLat: viewport.maxLat + 0.05,
                      minLng: viewport.minLng - 0.05,
                      maxLng: viewport.maxLng + 0.05,
                    });
                  }}
                  className="h-7 text-[10px] px-2"
                >
                  Pan Out
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setViewport({
                      minLat: 25.35,
                      maxLat: 25.4,
                      minLng: 51.5,
                      maxLng: 51.6,
                    });
                  }}
                  className="h-7 text-[10px] px-2"
                >
                  Focus Pearl
                </Button>
              </div>
            </div>
          </div>

          {/* Properties found sidebar */}
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col h-[550px]">
            <h3 className="font-semibold text-foreground text-sm border-b border-border/50 pb-2 flex justify-between items-center">
              <span>Listings in Viewport</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                ({properties.filter((p) => p.coordinates_lat && p.coordinates_lng).length} total)
              </span>
            </h3>

            <div className="flex-1 overflow-y-auto mt-3 space-y-3">
              {properties
                .filter((p) => p.coordinates_lat && p.coordinates_lng)
                .map((prop) => (
                  <div
                    key={prop.id}
                    onClick={() => handleOpenForm(prop)}
                    className="p-2.5 rounded-lg border border-border hover:bg-muted bg-muted/40 cursor-pointer text-xs"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-primary">${prop.price.toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{prop.source}</span>
                    </div>
                    <p className="truncate text-muted-foreground mt-1">{prop.address}</p>
                    <div className="mt-1.5 flex gap-2 text-[10px] text-muted-foreground/80">
                      <span>🛌 {prop.beds} Beds</span>
                      <span>🛁 {prop.baths} Baths</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Property Dialog Form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle>{editingProperty ? "Edit Real Estate Property" : "Add Real Estate Property"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 py-1">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Neighborhood, City, Country"
                className="bg-muted border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Price</Label>
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="bg-muted border-border"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Source</Label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as PropertySource)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="Internal">Internal</option>
                  <option value="MLS">MLS</option>
                  <option value="Property Finder">Property Finder</option>
                  <option value="Bayut">Bayut</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Beds</Label>
                <Input
                  type="number"
                  value={beds}
                  onChange={(e) => setBeds(e.target.value)}
                  placeholder="0"
                  className="bg-muted border-border"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Baths</Label>
                <Input
                  type="number"
                  value={baths}
                  onChange={(e) => setBaths(e.target.value)}
                  placeholder="0"
                  className="bg-muted border-border"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Status</Label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PropertyStatus)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="Active">Active</option>
                  <option value="Pending">Pending</option>
                  <option value="Sold">Sold</option>
                  <option value="Off-Market">Off-Market</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Lat</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="25.32"
                  className="bg-muted border-border"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Lng</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="51.53"
                  className="bg-muted border-border"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Features (comma separated)</Label>
              <Input
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
                placeholder="Pool, Gym, Sea View, Security"
                className="bg-muted border-border"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Property details..."
                className="bg-muted border-border min-h-[70px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleSaveProperty} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Saving..." : "Save Property"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
