const cardSharesRepo = require('../repositories/card-shares');
const { sanitizePlayerCoverUrlForClient } = require('../utils/media-url');
const { ErrorCode } = require('../error-codes');

function mapGiftInboxRow(row) {
    if (!row) return null;
    const coverRaw =
        (row.cover_image && String(row.cover_image).trim()) ||
        (row.artist_bg_image && String(row.artist_bg_image).trim()) ||
        '';
    const musicCover = row.player_cover_url
        ? sanitizePlayerCoverUrlForClient(row.player_cover_url)
        : '';
    const message = row.message != null ? String(row.message) : '';
    const preview = message.length > 48 ? `${message.slice(0, 48)}…` : message;
    return {
        shareId: row.share_id,
        recipient: row.recipient || '',
        messagePreview: preview,
        workTitle: row.work_title || '专属助眠曲',
        coverUrl: coverRaw || musicCover || '',
        musicId: row.music_id || '',
        senderId: row.sender_id || '',
        sharedAt: row.shared_at || '',
        firstOpenedAt: row.first_opened_at || '',
        lastOpenedAt: row.last_opened_at || ''
    };
}

function recordGiftOpen(userId, shareId) {
    if (!cardSharesRepo.isShareUuid(shareId)) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '分享ID无效' };
    }
    const share = cardSharesRepo.findShareSenderMeta(shareId);
    if (!share) {
        return { ok: false, error: ErrorCode.SHARE_NOT_FOUND };
    }
    if (share.sender_id && String(share.sender_id) === String(userId)) {
        return { ok: true, data: { recorded: false, reason: 'self_share' } };
    }
    cardSharesRepo.upsertGiftInbox(userId, shareId, share.sender_id);
    return { ok: true, data: { recorded: true, shareId } };
}

function listGiftInbox(userId, limit = 50) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const rows = cardSharesRepo.listGiftInboxRows(userId, limitNum);
    return {
        list: rows.map(mapGiftInboxRow).filter(Boolean),
        total: rows.length
    };
}

function removeFromGiftInbox(userId, shareId) {
    if (!cardSharesRepo.isShareUuid(shareId)) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '分享ID无效' };
    }
    const r = cardSharesRepo.deleteGiftInboxItem(userId, shareId);
    return { ok: true, data: { removed: r.changes > 0 } };
}

module.exports = {
    mapGiftInboxRow,
    recordGiftOpen,
    listGiftInbox,
    removeFromGiftInbox
};
