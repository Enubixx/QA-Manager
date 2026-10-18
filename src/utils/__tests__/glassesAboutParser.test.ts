import { describe, it, expect } from 'vitest';
import { parseGlassesAbout, normalizeFirmware } from '../glassesAboutParser';
import { isNativeApp, saveGlassesBuild } from '../../services/deviceBuilds';

describe('glassesAboutParser & deviceBuilds', () => {
  it('parses a standard Glasses About screen cleanly', () => {
    const res = parseGlassesAbout(
      [
        'About',
        'Phone',
        'Glasses Core',
        '1.0.450200_RC00',
        'Glasses app',
        '2.1.003',
        'Glasses',
        'Product',
        'Warby Parker',
        'Model',
        'Alma',
        'Serial number',
        'Glasses: R4AL4003J0B',
        'Version',
        'BGH4.260901.003 (O20XXUEU1AZJ5)',
        'Connection',
        'Connected',
      ].join('\n')
    );
    expect(res.coreVersion).toBe('1.0.450200_RC00');
    expect(res.companionVersion).toBe('2.1.003');
    expect(res.product).toBe('Warby Parker');
    expect(res.model).toBe('Alma');
    expect(res.serial).toBe('R4AL4003J0B');
    expect(res.firmware).toBe('BGH4.260901.003 (O20XXUEU1AZJ5)');
  });

  it('ignores unlabelled status noise ("Battery 85%", "Connected") after Serial number (B1)', () => {
    const r1 = parseGlassesAbout('Glasses\nSerial number\nR4AL4003J0B\nBattery 85%\nVersion\nBGH4.260901.003');
    expect(r1.serial).toBe('R4AL4003J0B');
    const r2 = parseGlassesAbout('Glasses\nSerial number\nR4AL4003J0B\nConnected\nVersion\nBGH4.260901.003');
    expect(r2.serial).toBe('R4AL4003J0B');
  });

  it('collapses wrapped multi-line firmware variant "(O20XX\\nUEU1AZJ5)" without spaces (B2)', () => {
    const fw = normalizeFirmware('BGH4.260901.003 (O20XX\nUEU1AZJ5)');
    expect(fw.value).toBe('BGH4.260901.003 (O20XXUEU1AZJ5)');
    const parsed = parseGlassesAbout('Glasses\nVersion\nBGH4.260901.003 (O20XX\nUEU1AZJ5)');
    expect(parsed.firmware).toBe('BGH4.260901.003 (O20XXUEU1AZJ5)');
  });

  it('extracts firmware when "Version" appears before "Serial number" without a "Glasses" header (B3)', () => {
    const parsed = parseGlassesAbout('Version\nBGH4.260901.003 (ENG)\nSerial number\nR4AL4003J0B');
    expect(parsed.firmware).toBe('BGH4.260901.003 (ENG)');
    expect(parsed.serial).toBe('R4AL4003J0B');
  });

  it('preserves firmware variants containing _, -, . or <5 chars (B4)', () => {
    expect(normalizeFirmware('BGH4.260901.003 (O20XX_DEV)').value).toBe('BGH4.260901.003 (O20XX_DEV)');
    expect(normalizeFirmware('BGH4.260901.003 (ENG)').value).toBe('BGH4.260901.003 (ENG)');
    expect(normalizeFirmware('BGH4.260901.003 (RC1)').value).toBe('BGH4.260901.003 (RC1)');
    expect(normalizeFirmware('BGH4.260901.003 (v1.2-rc1)').value).toBe('BGH4.260901.003 (V1.2-RC1)');
  });

  it('handles labels with tab / NBSP and single-line "Serial number: ..." / "Version: ..." (B5)', () => {
    const rTab = parseGlassesAbout('Serial\tnumber\nR4AL4003J0B\nVersion\u00a0\nBGH4.260901.003');
    expect(rTab.serial).toBe('R4AL4003J0B');
    expect(rTab.firmware).toBe('BGH4.260901.003');

    const rSingle = parseGlassesAbout('Serial number: R4AL4003J0B\nVersion: BGH4.260901.003 (ENG)');
    expect(rSingle.serial).toBe('R4AL4003J0B');
    expect(rSingle.firmware).toBe('BGH4.260901.003 (ENG)');
  });

  it('joins multi-word product continuations with space and strips "Up to date" version subtitles (B6)', () => {
    const r = parseGlassesAbout(
      [
        'Glasses Core',
        '1.2.3.4',
        'Up to date',
        'Glasses app',
        '2.0.1 Up to date',
        'Glasses',
        'Product',
        'Ray-Ban',
        'Meta',
        'Serial number',
        'R4AL4003J0B',
        'Version',
        'BGH4.260901.003',
      ].join('\n')
    );
    expect(r.coreVersion).toBe('1.2.3.4');
    expect(r.companionVersion).toBe('2.0.1');
    expect(r.product).toBe('Ray-Ban Meta');
  });

  it('guards window access in Node and refreshes capturedAt on saveGlassesBuild (B7)', () => {
    expect(isNativeApp()).toBe(false);
    const oldIso = '2025-01-01T00:00:00.000Z';
    const saved = saveGlassesBuild({ firmware: 'BGH4.260901.003', serial: 'R4AL4003J0B', capturedAt: oldIso });
    expect(saved.capturedAt).not.toBe(oldIso);
  });
});
