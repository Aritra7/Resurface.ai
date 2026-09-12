function partsAt(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: value("year"), month: value("month"), day: value("day"), hour: Number(value("hour")), minute: Number(value("minute")) };
}

export function reminderDateKey(timezone: string, now = new Date()) {
  try {
    const parts = partsAt(now, timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isReminderDue(reminderTime: string, timezone: string, now = new Date()) {
  const [targetHour = 0, targetMinute = 0] = reminderTime.split(":").map(Number);
  try {
    const parts = partsAt(now, timezone);
    return parts.hour * 60 + parts.minute >= targetHour * 60 + targetMinute;
  } catch {
    return now.getHours() * 60 + now.getMinutes() >= targetHour * 60 + targetMinute;
  }
}
