// Standardized local calendar date utility
// Format: YYYY-MM-DD in the device's local timezone
export const getLocalDateStr = (d?: Date | string | number | null): string => {
  try {
    if (d === undefined) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    if (d === null) return '';
    if (typeof d === 'string') {
      const trimmed = d.trim();
      if (!trimmed) return '';
      const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (ymdMatch) {
        const y = Number(ymdMatch[1]);
        const m = Number(ymdMatch[2]);
        const day = Number(ymdMatch[3]);
        const localDate = new Date(y, m - 1, day);
        if (
          localDate.getFullYear() === y &&
          localDate.getMonth() === m - 1 &&
          localDate.getDate() === day
        ) {
          return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
        }
        return '';
      }
      const dateObj = new Date(trimmed);
      if (isNaN(dateObj.getTime())) return '';
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dayNum = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${dayNum}`;
    }
    if (typeof d === 'number' && !Number.isFinite(d)) return '';
    const dateObj = d instanceof Date ? d : new Date(d);
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return '';
  }
};
