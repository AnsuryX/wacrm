"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Booking, Integration, Contact, Property } from "@/types";
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
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";

export default function CalendarPage() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Booking Form State
  const [bookingOpen, setBookingOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [contactId, setContactId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Integrations State
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [bookingsRes, integrationsRes, contactsRes, propertiesRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("*, contact:contacts(*), property:properties(*)")
          .eq("account_id", accountId),
        supabase
          .from("integrations")
          .select("*")
          .eq("account_id", accountId),
        supabase
          .from("contacts")
          .select("*")
          .eq("account_id", accountId)
          .order("name"),
        supabase
          .from("properties")
          .select("*")
          .eq("account_id", accountId)
          .order("address"),
      ]);

      if (bookingsRes.data) setBookings(bookingsRes.data as Booking[]);
      if (integrationsRes.data) setIntegrations(integrationsRes.data as Integration[]);
      if (contactsRes.data) setContacts(contactsRes.data as Contact[]);
      if (propertiesRes.data) setProperties(propertiesRes.data as Property[]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Connect External Calendar simulating OAuth flow
  const connectCalendar = async (provider: "google" | "outlook" | "cal") => {
    const isConnected = integrations.some((i) => i.provider === provider && i.active);

    if (isConnected) {
      // Disconnect
      const { error } = await supabase
        .from("integrations")
        .update({ active: false })
        .eq("account_id", accountId)
        .eq("provider", provider);

      if (error) {
        toast.error(`Failed to disconnect ${provider}.`);
      } else {
        toast.success(`Disconnected from ${provider}.`);
        loadData();
      }
    } else {
      // Connect (Mock OAuth2 / Integration Link)
      const { error } = await supabase
        .from("integrations")
        .insert({
          account_id: accountId,
          provider,
          active: true,
          credentials: {
            accessToken: "mock-oauth-token-12345",
            refreshToken: "mock-oauth-refresh-token",
            calendarName: "Ansury Real Estate Calendar",
            webhookSecret: "cal-webhook-secret-xyz",
          },
        });

      if (error) {
        toast.error(`Failed to connect ${provider}.`);
      } else {
        toast.success(`Successfully connected to ${provider}! Bidirectional sync active.`);
        loadData();
      }
    }
  };

  const handleSaveBooking = async () => {
    if (!contactId || !propertyId || !scheduledTime) {
      toast.error("Contact, Property, and Time are required.");
      return;
    }
    setSaving(true);

    const { error } = await supabase.from("bookings").insert({
      account_id: accountId,
      contact_id: contactId,
      property_id: propertyId,
      scheduled_time: new Date(scheduledTime).toISOString(),
      feedback_notes: feedbackNotes.trim() || null,
      status: "Scheduled",
    });

    if (error) {
      toast.error("Failed to schedule booking.");
    } else {
      toast.success("Property viewing scheduled and calendar synced!");
      setBookingOpen(false);
      setContactId("");
      setPropertyId("");
      setScheduledTime("");
      setFeedbackNotes("");
      loadData();
    }
    setSaving(false);
  };

  // Rendering Helper Methods for Month View
  const renderMonthDays = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const startDate = startOfWeek(monthStart);
    const endDate = addDays(monthEnd, 6 - monthEnd.getDay());

    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return (
      <div className="grid grid-cols-7 gap-px border-b border-border bg-border/20">
        {/* Days of week headers */}
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="bg-card py-2 text-center text-xs font-semibold text-muted-foreground border-b border-border">
            {day}
          </div>
        ))}

        {days.map((day, idx) => {
          const dayBookings = bookings.filter((b) => b.scheduled_time && isSameDay(new Date(b.scheduled_time), day));
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();

          return (
            <div
              key={idx}
              className={`min-h-[100px] bg-card p-2 flex flex-col justify-between hover:bg-muted/40 transition-colors ${
                isCurrentMonth ? "" : "text-muted-foreground opacity-40"
              }`}
            >
              <span className="text-xs font-bold">{day.getDate()}</span>

              <div className="mt-1 flex-1 overflow-y-auto space-y-1 max-h-[80px]">
                {dayBookings.map((b) => (
                  <div
                    key={b.id}
                    className="p-1 rounded text-[10px] font-semibold truncate bg-primary/10 border border-primary/20 text-primary flex items-center justify-between"
                  >
                    <span className="truncate">{b.property?.address || "Viewing"}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary animate-pulse" />
            Scheduling & Calendar Hub
          </h1>
          <p className="text-sm text-muted-foreground">
            View property viewings, CMA review calls, and external calendar integrations (Google, Outlook, Cal.com)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIntegrationsOpen(true)}
            className="border-border bg-card hover:bg-muted"
          >
            <Settings className="mr-1 h-4 w-4" />
            Integrations
          </Button>

          <Button
            onClick={() => setBookingOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Schedule Viewing
          </Button>
        </div>
      </div>

      {/* Calendar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-border bg-card p-3 rounded-xl shadow-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)));
            }}
            className="h-8 w-8 border-border"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-bold text-foreground">
            {format(currentDate, "MMMM yyyy")}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)));
            }}
            className="h-8 w-8 border-border"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Sync Indicator */}
        <div className="flex items-center gap-1.5 text-xs text-green-400 font-semibold bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full">
          <CheckCircle className="h-3.5 w-3.5" />
          <span>Bi-directional Sync Active (Google & Outlook)</span>
        </div>
      </div>

      {/* Main Month Grid */}
      {loading ? (
        <div className="flex py-20 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
          {renderMonthDays()}
        </div>
      )}

      {/* Schedule Viewing Dialog */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="sm:max-w-md bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle>Schedule Property Viewing</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Select Contact / Prospect</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm outline-none focus:border-primary"
              >
                <option value="">Select Contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Select Property</Label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm outline-none focus:border-primary"
              >
                <option value="">Select Property</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address} (${p.price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Scheduled Date & Time</Label>
              <Input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="bg-muted border-border"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Feedback / Viewing Notes</Label>
              <Textarea
                value={feedbackNotes}
                onChange={(e) => setFeedbackNotes(e.target.value)}
                placeholder="Specific instructions, key entry codes, or custom requests..."
                className="bg-muted border-border min-h-[70px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleSaveBooking} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? "Scheduling..." : "Confirm & Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calendar Integrations Configuration Dialog */}
      <Dialog open={integrationsOpen} onOpenChange={setIntegrationsOpen}>
        <DialogContent className="sm:max-w-md bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle>Connect External Scheduling Providers</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Authorize Ansury Systems Real Estate AI Agents to dynamically look up calendar availability and create events.
            </p>

            {/* Google Calendar Card */}
            <div className="flex items-center justify-between rounded-xl border border-border p-3 bg-muted/20">
              <div>
                <h4 className="text-sm font-bold text-foreground">Google Calendar</h4>
                <p className="text-[11px] text-muted-foreground">Sync listings viewings with Gmail & personal Google Calendar</p>
              </div>
              <Button
                variant={integrations.some((i) => i.provider === "google" && i.active) ? "destructive" : "default"}
                size="sm"
                onClick={() => connectCalendar("google")}
              >
                {integrations.some((i) => i.provider === "google" && i.active) ? "Disconnect" : "Connect"}
              </Button>
            </div>

            {/* Microsoft Outlook Card */}
            <div className="flex items-center justify-between rounded-xl border border-border p-3 bg-muted/20">
              <div>
                <h4 className="text-sm font-bold text-foreground">Microsoft Outlook 365</h4>
                <p className="text-[11px] text-muted-foreground">Bidirectional sync via Microsoft Graph API for brokers</p>
              </div>
              <Button
                variant={integrations.some((i) => i.provider === "outlook" && i.active) ? "destructive" : "default"}
                size="sm"
                onClick={() => connectCalendar("outlook")}
              >
                {integrations.some((i) => i.provider === "outlook" && i.active) ? "Disconnect" : "Connect"}
              </Button>
            </div>

            {/* Cal.com Webhook Card */}
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Cal.com Scheduling Webhook</h4>
                  <p className="text-[11px] text-muted-foreground">Direct webhook mapping for Cal.com booking widgets</p>
                </div>
                <Button
                  variant={integrations.some((i) => i.provider === "cal" && i.active) ? "destructive" : "default"}
                  size="sm"
                  onClick={() => connectCalendar("cal")}
                >
                  {integrations.some((i) => i.provider === "cal" && i.active) ? "Deactivate" : "Activate"}
                </Button>
              </div>

              {integrations.some((i) => i.provider === "cal" && i.active) && (
                <div className="mt-2 p-2 rounded bg-background border border-border/50 text-[10px] space-y-1">
                  <span className="font-semibold block uppercase tracking-wider text-primary">Webhook Ingestion Endpoint:</span>
                  <p className="font-mono text-muted-foreground break-all select-all">
                    https://crm.ansurysystems.com/api/v1/integrations/cal/webhook
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setIntegrationsOpen(false)} className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
