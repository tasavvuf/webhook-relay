import hashlib
import hmac
import secrets


def generate_slug() -> str:
    """Generate a unique URL-safe endpoint slug (e.g., wh_a8f92k1b)."""
    return f"wh_{secrets.token_hex(4)}"


def generate_signing_secret() -> str:
    """Generate a high-entropy webhook signing secret prefixed with whsec_."""
    return f"whsec_{secrets.token_hex(24)}"


def compute_hmac_signature(secret: str, payload: bytes) -> str:
    """Compute X-Webhook-Signature value in 'sha256=<hex_digest>' format."""
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_hmac_signature(secret: str, payload: bytes, signature_header: str | None) -> bool:
    """Verify X-Webhook-Signature in constant time using hmac.compare_digest."""
    if not secret or not signature_header:
        return False

    provided = signature_header.strip()
    if not provided.startswith("sha256="):
        return False

    provided_hex = provided[len("sha256=") :].lower()
    expected = compute_hmac_signature(secret, payload)
    return hmac.compare_digest(expected, f"sha256={provided_hex}")


def compute_fallback_idempotency_key(slug: str, payload: bytes) -> str:
    """Compute a deterministic SHA-256 idempotency key from endpoint slug and raw body."""
    return hashlib.sha256(slug.encode("utf-8") + payload).hexdigest()
