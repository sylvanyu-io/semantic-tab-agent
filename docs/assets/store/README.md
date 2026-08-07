# Chrome Web Store assets

Generate the complete set with:

```bash
npm run assets:store
```

## Localized screenshots

Select the matching locale in Chrome Web Store Developer Dashboard and upload the three screenshots in filename order. The sequence leads with the core grouping result, then cleanup review, and ends with the activity recap.

- English (`en`): `en/01-groups.png`, `en/02-cleanup.png`, `en/03-recap.png`
- Simplified Chinese (`zh_CN`): `zh_CN/01-groups.png`, `zh_CN/02-cleanup.png`, `zh_CN/03-recap.png`

Every localized screenshot is a full-bleed, RGB `1280x800` PNG. Do not upload one locale's screenshots under the other locale.

## Global assets

- Store icon: `../../../icons/icon128.png`
- Small promo tile: `global/small-promo-440x280.png`
- Marquee promo tile: `global/marquee-1400x560.png`

The promo tiles are shared by every locale, so their copy is intentionally short and uses the default English listing language.
