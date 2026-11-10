// Adapted for Sparkle Cleaner by Harshal Patil. Original MIT notices retained (see LICENSE).
// Ported from GargantuaX/gemini-watermark-remover (MIT): Veo text watermark templates + detector.
const Veo = (() => {
const VEO_TEXT_TEMPLATE_BASE_ALPHA_GAIN = 0.18;

const VEO_TEXT_TEMPLATE_IDS = Object.freeze([
    'veo-text-23x10',
    'veo-text-68x30',
    'veo-text-99x43'
]);

const RAW_TEMPLATE_BASE64 = Object.freeze({
    'veo-text-23x10': 'AQoHAAAAAgsEAAAAAAAAAAAAAAAAAAAKV0AHAAEYXCMDAAAAAAAAAAAAAAAAAAY+YQ4ABjpdDwIHCQYAAAABBgkHAgAAAyVmJwMNXEkLGD9MOA4BARQ7SkIaBQAADFFCCiJnKBxYST5bTwsOWlxASV8nAwAGO18WSF0VQ1okHC9jIS5iIQgQSk0JAAASZTVfOBBUZ05KS1AfOVMLAAUzWgsAAApWY2sYCUNWGg8UGwotYBYGD0hRCQAABTRrVgoCHlxINU5QDxRcXDpMYisEAAAADEAmBAAEHEdOPhoDAxlET0wjBgA=',
    'veo-text-68x30': 'AgEABgQEBgIBAQICAQICAQECAgIABgQFAwACAgEBAgMBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQECAAl1en15IwIBAgMCAQEBAQECAgx7foF7KAMCAQECAgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQIAAUZ/fn9fAgECAgIBAgICAgIDNH2AgG4FAwIBAQEBAQEBAQEBAQEBAQABAQEBAQEBAQEBAQICAgICAgICAQEBAQEBAQECHYCAgHcFAwIDAgICAwMDAgNhfX+BTwMEAgEBAQECAgEBAgEBAQEBAQEBAQEBAQEBAQEBAgICAgICAgIBAQEBAQEBAQECdoCBgDECAwMCAgICAwEBEYGAgn8YAgICAQEBAQICAgEBAQEBAQEBAQEBAQEBAQEBAQEBAQICAgICAgEBAQIBAQEBAQFLfoB+XgIDAwICAgICAgMvgYF/bwQBAgEBAQECAgIBAQEBAQEBAQEBAQEBAQAAAQEBAQECAgIBAgEBAQEBAgEBAQEBASJ/fn91DQICAgICAgICBVyAf344AgIBAQEBAQIDAwMCAgEBAQEBAQEBAQEBAQEBAQEBAgICAQEAAAABAQEBAQIBAQEBBWx/f4AvAwICAgIDAwMQeH9/exQBAgECAQEBAggMCwgCAQEBAQEBAQIBAQEBAQECAgMHCAgGAgEBAQEBAQECAgEBAQEDQIGBgV8EAQEBAgICA0F/gIBeAwECAgICDEBvf39/gXFSFgUCAgICAwIBAQIBBRREb4GCgIJwVBQEAQEBAQECAQEBAQMUfoGAfg0CAQECAgIFbX9/fy8DAgIDBDF1fX+BgYCBgIB7QAUDAwMDAgEBAgM4dX+Bf4KDgYKBe0EFAgEBAgIBAQECAwZggIGBOAQBAgICBRx/foB9DAECAQdAf4CBf4B/f3+AgIGAQAQCAwMCAgMFUH6CgoGAgH+AgIGBf2gNAwICAwEBAQEBATh/gIFeAgEBAgEETX+BflAFAwMDKXt/gH1hMhgZMV9/gYF+IwMCAwICA0B+gYB/eFM7OlFwgIB/fVEDAgICAQEBAQMDC3yBg38RAgIDAwduf4B8KgUDAwVtgH9+QQQDAgMDBUB9gH9uBgIDAwMUfIB+fkwMBQMCBQ0+gH+CfikDAgIBAQEBAwIJX4KCgDoCAwMEInuCgG0IAgIBMH5/f1IEAgECAgIBAlF/gX0jAwMDBVt9gIBSBAEBAQAEAwhMf4GAZQcDAgEBAQECAgcwgoJ/YgMCAgNRgYCATwQEAwNef398FAMEAwQEAwMDJn6Af0cDAwMTfH6AahUCAwIDAwICAgx0gYB/IgECAQEBAQICAg17gYJ+BAMDBHeCgIEaBAQDB32BgHZAPz0+Pj8+Pj5GfoOBVgMDAyl/f35RAwIBAwMCAwEDBUCAgn44BAIBAQEBAgECA1p/gIA3AgMzgIGAbQICBAIaf4GAgoCAgoGBgYGBgIGBgX9wBAICPX9/fzEDAgECAgIDAgICKYCCfk4EAgEBAAACAgICJX+CgVwEBFeCgn8zAQEDAh5+gYGAf35/fn9/f39+fn9+fm0GAwNBfoCAMQIBAQICAgICAQEjgIF+UQMCAQEAAQEBAgIGdIKDfg4MfIGBehUBAQICGX6AgWAzMTExMTExMjEwMS4wKgQCAz5/gYE1AwEBAgICAgICAiaAgX5OAgIBAQEBAgICAwVJf4F/NTB9gYBgBAICAwIOfYCCXQYDBAICAgIDAgECAwQEAgICNICCg0cEAQECAgICAgIENIGCf0YCAgEBAQEBAQICAyKAgoFgXX2BfTECAgICAwRugIF8DgMDAQECAwQDAwIDAgMCAgESfoOAdgYBAQIDAgEBAgdvgoJ8IAMEAQEBAQEBAQIBBXd/gH5+fn99CwECAgICBEB/f3xIBQMCAgICAgMTXTkVAwICAwZcg4N9QwIBAQIBAwECOHuAgWsJAwIBAQEBAQEBAQEEQn6Bf4B/f08EAQICAgMCFHWBgX1DBgMCBAUGFW5/fG0hAwICAyh+gYB9PQQFAwMEBC9+g4B+PwQCAgEBAQEBAQICAQIkgIKBgIB8JgICAgIDAwIFOn+CgH5sLxsQFkJ2gH6AbgQCAgIDBGGDgYB7bDogIjFdfIB/gm4EAQIBAQEBAQEBAQEBAgdcgoCCgGwOAgECAgICAwIJR4CAf4GBgYGBgYB+fmcVAQIBAQICDm19gIB/gX6AgX+AgH1rEwMCAgEBAQAAAQEBAQIBAz2Af4B+TQoCAgICAgICAQEJQX1/gIGAgIGBf3xnFgQDAgICAgMFC1B8f4CBgYGBgYB9XhQDAgICAQEBAAABAQEBAQIBDV9fX14UAgIBAgICAgEBAQIFElB7fH+Af3xuPwsCAgICAgICAgUDBzJifn9+foB9YzAFAgICAgIBAQEAAAEBAQECAgIBAwMDAwEBAQECAQICAgECAgIDBAYlKy4rEwUEAgICAgICAgEBAgIDAwMNIysyIAsEAgIDAwICAgIBAQABAQEBAQEBAQABAQEBAQEBAQICAQICAgECAgECAQIDAwMCAgEBAgICAgICAgICAgEBAgEBAQEBAQEBAQEBAQEBAgEBAQEBAQEBAQEBAQEBAQEBAQEBAgICAgICAgICAgMCAgICAgIBAQEBAgEBAQEBAgEBAQEBAgICAgICAgIBAQICAQEBAQEB',
    'veo-text-99x43': 'AQMCAQEAAAABAgMDAQEBAQEBAQEBAQEBAQEBAQIBAgMAAQECAQEBAQEBAQEAAAAAAAAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEdXUpJTlYyAwUCAgEBAQEBAQEBAQEBAQEBAQITOD07NzIfAQEBAQEBAQEAAAAAAAAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAopqKeoKKGEAICAgEBAQEBAQEBAQEBAAAAAAFcqJ2Zm6FqAQEBAQEBAQEAAAAAAAAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAHfZqXl5WNFwAHAgICAgICAQEBAQEBAAAAAAN4kYeJipM+AQEBAQEBAQEAAAAAAAAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAOpqQlZGSRgQGAgICAgICAQEBAQAAAAABABmWjoyKkosVAQEBAQEBAQEAAQECAQAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgMAFpaNkI6UcwYEAgICAgICAgEBAQEBAAAAAEidjYuMlWwDAQEBAQEBAQEAAQEBAQAAAQAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAXKYjZGQkB0BAgICAgICAgIBAAAAAAABA4OWjY+LmDYBAAEAAAAAAQEAAQEBAQEAAQAAAAAAAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAD2Xj5CQlU8BAgICAwICAgIBAAAAAQEBDJiNj5CShAsBAQEAAAEBAQEBAQEBAQEBAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQEBAAAAAAAAAAAAAAAAAAAAAQEAAA2Mko6SlnwEAgMCAwMCAgIAAAAAAAAAUJeOj46bTQEBAQEAAQEBAQEBAQECAgEBAQEBAAAAAAABAQAAAAAAAAAAAAAAAAABAQEBAAAAAAAAAAABAQEBAAAAAAAAAAAAAQEAAABkmI6RkpMkAwIDAwMCAgEAAAEBAQIDeZSOjpGMJAABAgEAAQABAAIAAAICAQEBAQEBAgABAQEBAAAAAAAAAAAAAAAAAAABAQEBAQAAAAAAAAECAQEBAQAAAAAAAAAAAQEAAAAum4uRjJdeCQMEBAMCAgIBAQABAQAklZCOjpVxAwECAgEBAQABAAAAAAMDAgEBAgIBAQIBAQEAAAAAAAAAAAAAAAAAAQEBAQEBAQEBAQEBAAECAAECAgAAAAAAAAAAAQEAAAIIh46Ri5F9DgQDBQQCAgIBAQAAAAFNnI6PkJdBAQECAgEBAgEBAAAAAQMHDQ8MCAMBAQEBAQABAQAAAAAAAAAAAAEBAQABAQEBAgMGCAcGBAIAAAEBAAEAAAAAAAAAAAEAAQICYJmSjI2OKAQEBAMCAgIBAQEBAguAlY+SkooYAQECAQICAwIBARxLaYaJiouJiHJGFwICBAIBAAEAAAAAAAAAAAEBAQIBARQ9Z36JjI6NhG9DGAADAgMAAAAAAAAAAQEAAAMAK5SSjo6QVQUBAwMCAgIBAQEBATCXj5COlmQHAQECAgEBAwEWVomSk5ORkZKTlJuchlYPAgEBAQEAAAAAAAAAAAEBAgAWUImWmpOUlZaXl5udkV4aAAQAAAAAAAAAAAAAAAIFAoCZkI+QfxAAAQIBAgIBAQEBAmKZjpGSmjIBAQECAQICAy18nZCQkJGRkZGQkJGTmJx7JgEDAQEAAQAAAQEBAQEBBC96mZSTkpKTlJSUlZGQkZiNRwQAAAAAAAAAAAAAAAMDAlqakI6QmTIBAQIBAgICAQEBDIiUj5KUgQ0BAQICAgMBMJeVkI+Pj5KSkpOSkZePkY+bkjcCAAAAAQAAAAEBAQECQpGVi5GRkpSUlJOTl5GQkY6UlmYBAAAAAAAAAQEBAQICAhyYj46RlFwBAQEBAgICAgIDRZSRkJGXUwIBAQEBAgMYlZSVlo+akYVoV0tceZSbjJKMk5U1AAEAAQEBAgIAAgFClZOTj4yOk4d5bG16hpaXj46OkZldBgIBAQEBAQEBAQIBAgd9j42PkIAPAQEBAgICAgIBaJaRkZGPJgABAQECAA1zlpCTkJVtPBMDAAAABiNwmZCUiZCLEQEDAQEBAgEDACiTkI+Si5FzRhwLBAQLD0OBnZONkZKdQgIAAQAAAAABAQIBAQFRmI+Rj5EtAQEBAgIDBAEUjZGQj5V2BAACAQECAEOYiZaPj1gFAQECAQMBAAACUZqUjImWWAUAAgECAQECB32Ujo+LkFARAAABAAAAAgASZ5mPiY+XjBwBAgAAAAABAQEBAQApjpCSjJNeAQEBAgICAgI3lo6RjpREAAIBAQEBD46Li4+UXQQBAQEAAQEAAgMDAlmYj5CIlBsBAAEBAQEBQpSIjYuPawIAAgEAAAAAAwECCGSTjo+PnF4DAQAAAQEBAQIBAQEJdJiNjI2FDwEBAQIBAwNrlZCSkYoXBAIBAAIDU5mLj492DAECAgMCAwIBAgMFBQeFkouOlkcAAQEBAQEDfZOJjI18EgEBAQEBAQEBAQECARZ2lY6RkogXAAAAAQEBAgEBAQEAS5mSjY2OOAEBAgIEAhWSk5CRkGkFAQECBgEBfJSNj5Q3AgABAQEBAQEBAgICAwJXlY6NlmoEAAEBAAEkmIyMjYxNAAEBAQECAQIBAQIDAgE2lI2NjpVEAAEBAQEBAQEBAgIAHpKUjY6UagEBAQEDAUWZko6NjjEAAQMDBwAWkpGOlIAcBQMCAgICAgIBAgQCBAJBjoyQj4IKAAABAAFbmIqOjoEVAAEBAQEBAQICAQICAgMIfpKPj5RuAQABAAABAQEBAQIBA3WbkI2NhAUBAQIBAXOdkI6NjQoDAgMDAQAxk42Sj4tqWllQUFBRU1RUVVVRT1dxjoyQk5IXAAABAAF0kYuPlm4BAQEBAQECAQICAgICAgMAVZ2Ojo6AAwEBAAAAAQEBAQEBAkChjo2PlDgAAgIAEJCTkZCVagQCAgIBAQBTk46SkI6Sl5OUlZWVlJSTk5SSlJSSkpKTlJkkAQEAAAF+joqOmE4AAQEBAQEBAQEBAQEBAgIBNZ6NjY2LDgECAAAAAAEBAQEBARqQjo6Rk2QDAwUDQ5eOj4+YMwIBAgEBAgBZko6RkJOXl5OPkJCQkJCQkJCPkI+QkpKQj5gwAAAAAAKAj4qNmEEAAwEBAQEBAQEBAQEBAQEAK5mMjY6MFAECAAAAAAEBAQIDAwNpkI2Qj4YRAAQEe5SNjJaDBgIBAgEBAQJckY6Qj5eWmJmWlZaWlpaWl5eXmJmampiXmZo3AAABAAKBj4qNlzgABQEBAQEBAQEBAQEBAQEBJ5aLi46NGAECAAAAAAEBAQICAwE3ko2PjZM4AAIci46LjpdbAAEBAwIBAAJdk4+RkGgkKSopKSkqKisqKywtLSwtLiorPEAUAQAAAAKAj4qNlT4BBgECAQEBAQEBAQEBAQEBKpaLi4+NFwIBAQEBAQEBAgICAQEHkZGRj5BoAgNNl42OjZQkAAEBAgIBAgNWk4+RkGwLAQIBAQEAAAAAAAEBAAAAAQAAAQEBAQAAAAF6kIqPkVMBAwEBAQEBAAABAQEBAQEBP5aMio+IDQEBAQEBAAEBAQIBAQIBdZCMjY2EDgF1ko2RjH0GAAEBAgICAgJAlI+RkH0OAgICAgICAQEBAQEBAQEBAQEBAAAAAAAAAABtk4qOjHAAAwEBAQEBAAABAQEBAQEAXJiPi5J7BAEBAQEBAQAAAQEBAQEBMpWRj4yWOBCPj5CQmU4AAwICAgIDAgEbko+Rj4ojAgQCAgICAgICAwMEAwMEBAMBAQAAAAAAAABLlYqMkoYZAQABAQIBAQEBAQECAgATf5KPjJVdAQEBAQABAQAAAQEBAQEBA4OSj46QbUuOjo6PlCIBAgEBAgICAQIKjo2Rj5RDAQECAQECAgICAgICAQIQCgIBAQEBAAAAAAEskI2PjpFTAAEBAQICAQECAgEBAQE5koqQj5VBAQEBAAAAAAAAAAAAAAAAAliZi5COgHCPko6Yaw0AAQEBAgICAQEEXZqQkJ2EHgMDBAMDAwMCAwICABZzdksiGwUBAQEBAQEGd5ONj5GMJgAIAgQEBAMFAwIEARSEkoyMjoMRAAAAAAAAAAAAAAAAAAAAACeUj4+OiYSNjY6XPQcBAQEBAgICAQIBHYqUjYmafBkAAQICAwMCAwUBCGKXl5uZiB4AAwEBAQEEOZaRk46ShxgABAUEBAQDAwYBFnmVipCKlVADAAEAAAAAAAAAAAAAAAAAAgV8lI+PjYuOjo6JDAIBAQEBAQICAQICAU2UkZKImXwcAwIDAgICAQIFSJSQjpCWdAwBBAEBAQMGA2mckI+JkoE0CQIFBAMEBggkepiNkIyPeRIBAAAAAAAAAAAAAAAAAAAAAgBTlJGOjo6OkpdfAgIDAgEBAQECAgICAQR3mpCTipuMVR4JAgECBCxllYmPjoyRKwADAQECAQECAh+Il5CSjJSQbDUZDwsQMF+OlJOPi5CNMgAGAAABAAAAAAAAAAAAAAAABAAekJCOjo+OkpgnAgICAgICAgICAgIBAQAZe5yRk5KZmpR7cXF8iZeVj5GTjZVbCQIBAQEBAQECAgcwlJOOlI6Ul5WSkJCSl5uSkJOHjpU6BgMCAAAAAAAAAAAAAAAAAAAAAAIKbpOQj4+Rl3wIAQIBAgICAgICAgICBAIAH3qcm5ORkpebmZiYmJaSj5OTkV0IAQEBAQEBAQECAgEHQY+fkIqOj5GSkpOUl5KPj4+Xkk0GAgEAAAAAAAAAAAAAAAAAAAAAAgIAP5STkZKToVMCAQEBAgEBAQICAgECBAMBAApZlJ2VlJKVk5SUkpKUkZOOSwsAAQEBAQEBAQEBAgECACJ3npSRkZGRkZGRkZCNk5l3LwECAQEAAAAAAAAAAAAAAAAAAAAAAQIAGpGYl5eNhCABAgEBAQEBAQICAgICAwMCAwECKGyOlpubmpqYl5eSiWobBQEHAgEBAQEBAQEBAQEBAQIHQHqOmJaVlZOUlZKPfDsKAQgCAQAAAAAAAAAAAAAAAAAAAAAAAAEAAR0vLywcEgIBAQEBAQEBAQICAgICAgICAgICAwIbPVxtc3NybFA1EwkDAQEBAQEAAAAAAQEBAQAAAQEBAQoePFxsbG1rUD0eDQMBAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAAECAQAAAQAAAQECAgICAgICAgICAgMDAwIAAQADBQMDAgEBAQEBAQECAQEAAAAAAQEBAQABAQEBAQEAAAEDAwMDAAIBAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAEAAAAAAAAAAQAAAQEBAQICAgICAgICAgICAgEFAwEDAQEBAQIBAgIDAgICAQEAAAAAAAABAQABAQEBAQIAAQIAAAAAAQABAQEBAQEAAAAAAAAA'
});

const TEMPLATE_METADATA = Object.freeze({
    'veo-text-23x10': Object.freeze({
        id: 'veo-text-23x10',
        width: 23,
        height: 10,
        marginRight: 15,
        marginBottom: 16,
        minNcc: 0.62,
        observedSeedScale: 1.256,
        allenkObservedRegion: Object.freeze({ x: 682, y: 1254, width: 23, height: 10 }),
        cleanup: Object.freeze({
            allenkObservedFdncnnSigma: 20,
            runtimeFdncnnSigma: 90,
            allenkFdncnnPadding: 32
        })
    }),
    'veo-text-68x30': Object.freeze({
        id: 'veo-text-68x30',
        width: 68,
        height: 30,
        marginRight: 44,
        marginBottom: 48,
        minNcc: 0.62,
        observedSeedScale: 1,
        cleanup: Object.freeze({
            allenkObservedFdncnnSigma: 20,
            runtimeFdncnnSigma: 90,
            allenkFdncnnPadding: 38
        })
    }),
    'veo-text-99x43': Object.freeze({
        id: 'veo-text-99x43',
        width: 99,
        height: 43,
        marginRight: 64,
        marginBottom: 68,
        minNcc: 0.62,
        observedSeedScale: 1,
        cleanup: Object.freeze({
            allenkObservedFdncnnSigma: 20,
            runtimeFdncnnSigma: 90,
            allenkFdncnnPadding: 44
        })
    })
});

const decodedCache = new Map();

function decodeBase64Bytes(base64) {
    if (decodedCache.has(base64)) return decodedCache.get(base64);

    let bytes;
    if (typeof atob === 'function') {
        const binary = atob(base64);
        bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
    } else if (typeof Buffer !== 'undefined') {
        bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    } else {
        throw new Error('No base64 decoder available for Veo text watermark template');
    }

    decodedCache.set(base64, bytes);
    return bytes;
}

function normalizeTemplateBytes(bytes) {
    let max = 0;
    for (const value of bytes) {
        if (value > max) max = value;
    }
    if (max <= 0) return new Float32Array(bytes.length);
    return Float32Array.from(bytes, (value) => value / max);
}

function getVeoTextTemplateMetadata(id) {
    const metadata = TEMPLATE_METADATA[id];
    if (!metadata) return null;
    return {
        ...metadata,
        allenkObservedRegion: metadata.allenkObservedRegion
            ? { ...metadata.allenkObservedRegion }
            : undefined,
        cleanup: { ...metadata.cleanup }
    };
}

function getVeoTextTemplateAlphaMap(id, { alphaGain = VEO_TEXT_TEMPLATE_BASE_ALPHA_GAIN } = {}) {
    const raw = RAW_TEMPLATE_BASE64[id];
    if (!raw) return null;
    const normalized = normalizeTemplateBytes(decodeBase64Bytes(raw));
    const gain = Number.isFinite(alphaGain) && alphaGain > 0 ? alphaGain : VEO_TEXT_TEMPLATE_BASE_ALPHA_GAIN;
    return Float32Array.from(normalized, (value) => Math.max(0, Math.min(0.99, value * gain)));
}

function getVeoTextTemplateDetectorMap(id) {
    const raw = RAW_TEMPLATE_BASE64[id];
    return raw ? normalizeTemplateBytes(decodeBase64Bytes(raw)) : null;
}

function getVeoTextWatermarkTemplate(id, options = {}) {
    const metadata = getVeoTextTemplateMetadata(id);
    if (!metadata) return null;
    return {
        ...metadata,
        alphaMap: getVeoTextTemplateAlphaMap(id, options),
        detectorMap: getVeoTextTemplateDetectorMap(id)
    };
}

function getVeoTextWatermarkTemplates(options = {}) {
    return VEO_TEXT_TEMPLATE_IDS.map((id) => getVeoTextWatermarkTemplate(id, options));
}


const DEFAULT_MIN_NCC = 0.62;
const DEFAULT_VOTE_RATIO = 0.6;
const DEFAULT_ACTIVE_THRESHOLD = 0.02;
const DEFAULT_MARGIN_RADIUS_MIN = 4;
const DEFAULT_MARGIN_RADIUS_SCALE = 0.35;
const STABLE_LOW_CONTRAST_VOTE_RATIO = 0.8;
const STABLE_LOW_CONTRAST_MEAN_NCC_SCALE = 0.68;

function clampInteger(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function lumaAt(data, idx) {
    return (0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]) / 255;
}

function buildIntegerRange(center, radius, min, max) {
    const safeMin = Math.max(min, Math.round(center - radius));
    const safeMax = Math.min(max, Math.round(center + radius));
    const values = [];
    for (let value = safeMin; value <= safeMax; value++) {
        values.push(value);
    }
    return values;
}

function computeRectangularSpatialCorrelation({
    imageData,
    alphaMap,
    region,
    activeThreshold = DEFAULT_ACTIVE_THRESHOLD
}) {
    if (!imageData || !alphaMap || !region) return 0;
    const width = region.width ?? region.size;
    const height = region.height ?? region.size;
    if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        alphaMap.length !== width * height ||
        region.x < 0 ||
        region.y < 0 ||
        region.x + width > imageData.width ||
        region.y + height > imageData.height
    ) {
        return 0;
    }

    let imageSum = 0;
    let templateSum = 0;
    let count = 0;
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const template = alphaMap[row * width + col] || 0;
            if (Math.abs(template) <= activeThreshold) continue;
            const idx = ((region.y + row) * imageData.width + region.x + col) * 4;
            imageSum += lumaAt(imageData.data, idx);
            templateSum += template;
            count++;
        }
    }
    if (count <= 1) return 0;

    const imageMean = imageSum / count;
    const templateMean = templateSum / count;
    let numerator = 0;
    let imageEnergy = 0;
    let templateEnergy = 0;
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const template = alphaMap[row * width + col] || 0;
            if (Math.abs(template) <= activeThreshold) continue;
            const idx = ((region.y + row) * imageData.width + region.x + col) * 4;
            const imageDelta = lumaAt(imageData.data, idx) - imageMean;
            const templateDelta = template - templateMean;
            numerator += imageDelta * templateDelta;
            imageEnergy += imageDelta * imageDelta;
            templateEnergy += templateDelta * templateDelta;
        }
    }

    const denominator = Math.sqrt(imageEnergy * templateEnergy);
    return denominator > 0 ? numerator / denominator : 0;
}

function scoreVeoTextTemplateAt(imageData, template, x, y) {
    const ncc = computeRectangularSpatialCorrelation({
        imageData,
        alphaMap: template.detectorMap,
        region: {
            x,
            y,
            width: template.width,
            height: template.height
        }
    });
    return {
        ncc,
        confidence: Math.max(0, ncc)
    };
}

function resolveVeoTextSearchCandidates({
    width,
    height,
    templates = getVeoTextWatermarkTemplates(),
    marginRadiusX = null,
    marginRadiusY = null
} = {}) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [];
    }

    const candidates = [];
    for (const template of templates) {
        if (!template || template.width > width || template.height > height) continue;
        const radiusX = Number.isFinite(marginRadiusX)
            ? marginRadiusX
            : Math.max(DEFAULT_MARGIN_RADIUS_MIN, Math.round(Math.min(template.width, template.height) * DEFAULT_MARGIN_RADIUS_SCALE));
        const radiusY = Number.isFinite(marginRadiusY)
            ? marginRadiusY
            : Math.max(DEFAULT_MARGIN_RADIUS_MIN, Math.round(Math.min(template.width, template.height) * DEFAULT_MARGIN_RADIUS_SCALE));
        const centerRight = template.marginRight;
        const centerBottom = template.marginBottom;
        const rightMargins = buildIntegerRange(centerRight, radiusX, 0, width - template.width);
        const bottomMargins = buildIntegerRange(centerBottom, radiusY, 0, height - template.height);

        for (const marginRight of rightMargins) {
            for (const marginBottom of bottomMargins) {
                const x = width - marginRight - template.width;
                const y = height - marginBottom - template.height;
                if (x < 0 || y < 0 || x + template.width > width || y + template.height > height) {
                    continue;
                }
                candidates.push({
                    id: `${template.id}:${x}:${y}`,
                    watermarkKind: 'veo-text',
                    template,
                    x,
                    y,
                    width: template.width,
                    height: template.height,
                    marginRight,
                    marginBottom
                });
            }
        }
    }
    return candidates;
}

function summarizeVeoTextScores(frameScores) {
    if (!frameScores.length) {
        return {
            frames: 0,
            meanNcc: 0,
            maxNcc: 0,
            votes: 0
        };
    }
    let meanNcc = 0;
    let maxNcc = Number.NEGATIVE_INFINITY;
    for (const score of frameScores) {
        meanNcc += score.ncc;
        maxNcc = Math.max(maxNcc, score.ncc);
    }
    return {
        frames: frameScores.length,
        meanNcc: meanNcc / frameScores.length,
        maxNcc,
        votes: 0
    };
}

function isDefaultTemplateCandidate(summary) {
    const candidate = summary?.candidate;
    const template = candidate?.template;
    return (
        template &&
        candidate.marginRight === template.marginRight &&
        candidate.marginBottom === template.marginBottom
    );
}

function hasStableLowContrastEvidence(summary, effectiveMinNcc, minVoteRatio) {
    if (!isDefaultTemplateCandidate(summary)) return false;
    const requiredVoteRatio = Math.max(minVoteRatio, STABLE_LOW_CONTRAST_VOTE_RATIO);
    const requiredMeanNcc = effectiveMinNcc * STABLE_LOW_CONTRAST_MEAN_NCC_SCALE;
    return (
        summary.voteRatio >= requiredVoteRatio &&
        summary.maxNcc >= effectiveMinNcc &&
        summary.meanNcc >= requiredMeanNcc
    );
}

function formatVeoTextCandidateSummary(summary) {
    return {
        candidateId: summary.candidate.id,
        templateId: summary.candidate.template.id,
        x: summary.candidate.x,
        y: summary.candidate.y,
        width: summary.candidate.width,
        height: summary.candidate.height,
        marginRight: summary.candidate.marginRight,
        marginBottom: summary.candidate.marginBottom,
        meanNcc: summary.meanNcc,
        maxNcc: summary.maxNcc,
        votes: summary.votes,
        voteRatio: summary.voteRatio
    };
}

function selectVeoTextCandidateSummaries(summaries, limit = 20) {
    const selected = new Map();
    for (const summary of summaries.slice(0, limit)) {
        selected.set(summary.candidate.id, summary);
    }
    for (const summary of summaries) {
        if (isDefaultTemplateCandidate(summary)) {
            selected.set(summary.candidate.id, summary);
        }
    }
    return [...selected.values()].map(formatVeoTextCandidateSummary);
}

function createEmptyVeoTextDetection({ frameCount = 0, minNcc, candidates = [], frameWinners = [] }) {
    return {
        watermarkKind: 'veo-text',
        isConfident: false,
        position: null,
        alphaMap: null,
        template: null,
        summary: {
            frameCount,
            minNcc,
            candidates,
            frameWinners
        }
    };
}

function buildVeoTextDetectionResult({
    frames,
    perCandidate,
    frameWinners,
    minNcc,
    minVoteRatio
}) {
    const summaries = [...perCandidate.values()]
        .map((entry) => ({
            candidate: entry.candidate,
            ...summarizeVeoTextScores(entry.scores),
            votes: entry.votes,
            voteRatio: frames.length > 0 ? entry.votes / frames.length : 0
        }))
        .sort((left, right) => {
            if (right.votes !== left.votes) return right.votes - left.votes;
            return right.meanNcc - left.meanNcc;
        });

    const best = summaries[0] || null;
    if (!best) {
        return createEmptyVeoTextDetection({
            frameCount: frames.length,
            minNcc,
            candidates: [],
            frameWinners
        });
    }

    const effectiveMinNcc = Number.isFinite(best.candidate.template.minNcc)
        ? Math.min(minNcc, best.candidate.template.minNcc)
        : minNcc;
    const isConfident = (
        best.meanNcc >= effectiveMinNcc &&
        best.voteRatio >= minVoteRatio
    ) || hasStableLowContrastEvidence(best, effectiveMinNcc, minVoteRatio);
    const position = {
        x: best.candidate.x,
        y: best.candidate.y,
        width: best.candidate.width,
        height: best.candidate.height
    };
    const template = {
        id: best.candidate.template.id,
        width: best.candidate.template.width,
        height: best.candidate.template.height,
        cleanup: { ...best.candidate.template.cleanup }
    };

    return {
        watermarkKind: 'veo-text',
        position,
        alphaMap: best.candidate.template.alphaMap,
        alphaSeed: {
            seedGain: best.candidate.template.observedSeedScale || 1,
            estimates: [],
            estimateCount: 0,
            source: 'template-default'
        },
        template,
        candidate: {
            id: best.candidate.id,
            label: best.candidate.template.id,
            x: best.candidate.x,
            y: best.candidate.y,
            width: best.candidate.width,
            height: best.candidate.height,
            marginRight: best.candidate.marginRight,
            marginBottom: best.candidate.marginBottom
        },
        isConfident,
        summary: {
            frameCount: frames.length,
            minNcc: effectiveMinNcc,
            minVoteRatio,
            best: {
                candidateId: best.candidate.id,
                templateId: best.candidate.template.id,
                x: best.candidate.x,
                y: best.candidate.y,
                width: best.candidate.width,
                height: best.candidate.height,
                marginRight: best.candidate.marginRight,
                marginBottom: best.candidate.marginBottom,
                meanNcc: best.meanNcc,
                maxNcc: best.maxNcc,
                votes: best.votes,
                voteRatio: best.voteRatio
            },
            candidates: selectVeoTextCandidateSummaries(summaries),
            frameWinners
        }
    };
}

async function maybeYieldToMainThread(yieldToMainThread) {
    if (typeof yieldToMainThread === 'function') {
        await yieldToMainThread();
    }
}

function detectVeoTextWatermarkFromFrames({
    frames,
    width,
    height,
    templates = getVeoTextWatermarkTemplates(),
    minNcc = DEFAULT_MIN_NCC,
    minVoteRatio = DEFAULT_VOTE_RATIO,
    marginRadiusX = null,
    marginRadiusY = null
} = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
        return createEmptyVeoTextDetection({ minNcc });
    }

    const candidates = resolveVeoTextSearchCandidates({
        width,
        height,
        templates,
        marginRadiusX,
        marginRadiusY
    });
    const perCandidate = new Map(candidates.map((candidate) => [candidate.id, {
        candidate,
        scores: [],
        votes: 0
    }]));
    const frameWinners = [];

    for (const frame of frames) {
        let winner = null;
        for (const candidate of candidates) {
            const score = scoreVeoTextTemplateAt(frame.imageData, candidate.template, candidate.x, candidate.y);
            const scored = {
                timestamp: frame.timestamp,
                ncc: score.ncc,
                confidence: score.confidence
            };
            perCandidate.get(candidate.id).scores.push(scored);
            if (!winner || score.confidence > winner.confidence) {
                winner = {
                    candidateId: candidate.id,
                    templateId: candidate.template.id,
                    timestamp: frame.timestamp,
                    x: candidate.x,
                    y: candidate.y,
                    ncc: score.ncc,
                    confidence: score.confidence
                };
            }
        }
        if (winner) {
            frameWinners.push(winner);
            const entry = perCandidate.get(winner.candidateId);
            if (entry) entry.votes++;
        }
    }

    return buildVeoTextDetectionResult({
        frames,
        perCandidate,
        frameWinners,
        minNcc,
        minVoteRatio
    });
}

async function detectVeoTextWatermarkFromFramesAsync({
    frames,
    width,
    height,
    templates = getVeoTextWatermarkTemplates(),
    minNcc = DEFAULT_MIN_NCC,
    minVoteRatio = DEFAULT_VOTE_RATIO,
    marginRadiusX = null,
    marginRadiusY = null,
    yieldEveryCandidates = 96,
    yieldToMainThread = null
} = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
        await maybeYieldToMainThread(yieldToMainThread);
        return createEmptyVeoTextDetection({ minNcc });
    }

    const candidates = resolveVeoTextSearchCandidates({
        width,
        height,
        templates,
        marginRadiusX,
        marginRadiusY
    });
    const perCandidate = new Map(candidates.map((candidate) => [candidate.id, {
        candidate,
        scores: [],
        votes: 0
    }]));
    const frameWinners = [];
    const safeYieldEveryCandidates = Math.max(1, Math.round(yieldEveryCandidates || 96));
    let scoredCandidateCount = 0;

    for (const frame of frames) {
        let winner = null;
        for (const candidate of candidates) {
            const score = scoreVeoTextTemplateAt(frame.imageData, candidate.template, candidate.x, candidate.y);
            const scored = {
                timestamp: frame.timestamp,
                ncc: score.ncc,
                confidence: score.confidence
            };
            perCandidate.get(candidate.id).scores.push(scored);
            if (!winner || score.confidence > winner.confidence) {
                winner = {
                    candidateId: candidate.id,
                    templateId: candidate.template.id,
                    timestamp: frame.timestamp,
                    x: candidate.x,
                    y: candidate.y,
                    ncc: score.ncc,
                    confidence: score.confidence
                };
            }

            scoredCandidateCount++;
            if (scoredCandidateCount % safeYieldEveryCandidates === 0) {
                await maybeYieldToMainThread(yieldToMainThread);
            }
        }
        if (winner) {
            frameWinners.push(winner);
            const entry = perCandidate.get(winner.candidateId);
            if (entry) entry.votes++;
        }
        await maybeYieldToMainThread(yieldToMainThread);
    }

    return buildVeoTextDetectionResult({
        frames,
        perCandidate,
        frameWinners,
        minNcc,
        minVoteRatio
    });
}

function createSyntheticVeoTextWatermarkImageData({
    width,
    height,
    template,
    position,
    backgroundValue = 48
}) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let idx = 0; idx < data.length; idx += 4) {
        data[idx] = backgroundValue;
        data[idx + 1] = backgroundValue;
        data[idx + 2] = backgroundValue;
        data[idx + 3] = 255;
    }
    for (let row = 0; row < position.height; row++) {
        for (let col = 0; col < position.width; col++) {
            const alpha = template.alphaMap[row * position.width + col] || 0;
            const idx = ((position.y + row) * width + position.x + col) * 4;
            for (let channel = 0; channel < 3; channel++) {
                data[idx + channel] = Math.round(alpha * 255 + (1 - alpha) * data[idx + channel]);
            }
        }
    }
    return { width, height, data };
}

return { detectFromFrames: detectVeoTextWatermarkFromFrames };
})();
