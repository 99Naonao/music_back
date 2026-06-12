const { v4: uuidv4 } = require('uuid');
const cardSharesRepo = require('../repositories/card-shares');
const cardTemplates = require('../card-template-service');
const channelService = require('../channel-service');
const { getDb } = require('../bootstrap/database');
const { ErrorCode } = require('../error-codes');
const {
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient
} = require('../utils/media-url');

function mapMyShareRow(r) {
    return {
        shareId: r.id,
        musicId: r.music_id,
        recipient: r.recipient,
        message: r.message,
        template: r.template,
        templateId: r.template_id || '',
        musicInstrument: r.music_instrument,
        musicFrequency: r.music_frequency,
        musicBpm: r.music_bpm,
        coverImage: r.cover_image,
        audioUrl: r.audio_url,
        artistBgImage: r.artist_bg_image || '',
        createdAt: r.created_at
    };
}

function resolveShareTrackMeta(musicId) {
    let workTitle = '';
    let musicCoverUrl = '';
    let durationSec = 0;
    let audioUrl = '';
    if (!musicId) {
        return { workTitle, musicCoverUrl, durationSec, audioUrl };
    }
    const track = cardSharesRepo.findMusicTrackForShare(musicId);
    if (!track) {
        return { workTitle, musicCoverUrl, durationSec, audioUrl };
    }
    workTitle = track.title || '';
    musicCoverUrl = sanitizePlayerCoverUrlForClient(track.player_cover_url) || '';
    audioUrl = track.audio_url || '';
    const ms = track.audio_duration_ms;
    if (ms != null && Number(ms) > 0) {
        durationSec = Math.max(1, Math.ceil(Number(ms) / 1000));
    } else if (track.duration != null && Number(track.duration) > 0) {
        durationSec = Math.floor(Number(track.duration));
    }
    return { workTitle, musicCoverUrl, durationSec, audioUrl };
}

function createShare(params) {
    const {
        req,
        senderId,
        wxOpenid,
        musicId,
        recipient,
        message,
        template,
        templateId,
        musicInstrument,
        musicFrequency,
        musicBpm,
        coverImage,
        audioUrl,
        artistBgImage,
        savedToLibrary,
        scheduleAudioMediaCheck
    } = params;

    const savedToLib =
        savedToLibrary === true || savedToLibrary === 1 || savedToLibrary === '1' ? 1 : 0;

    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '音乐ID不能为空' };
    }
    if (!recipient || String(recipient).trim().length === 0) {
        return { ok: false, error: ErrorCode.RECIPIENT_EMPTY };
    }

    const coverRaw = coverImage != null ? String(coverImage).trim() : '';
    const hasCustomCover = coverRaw !== '';

    const db = getDb();
    const resolved = cardTemplates.resolveTemplateForShare(db, {
        templateId,
        template,
        artistBgImage,
        hasCustomCover
    });
    if (resolved.error === 'INVALID_TEMPLATE') {
        return { ok: false, error: ErrorCode.CARD_TEMPLATE_INVALID };
    }

    const shareId = uuidv4();
    const sourceChannel = channelService.resolveSourceChannel(db, req);

    cardSharesRepo.insertShare({
        id: shareId,
        musicId,
        senderId,
        recipient,
        message: message || '',
        template: resolved.template,
        templateId: resolved.templateId,
        musicInstrument,
        musicFrequency,
        musicBpm,
        coverImage: coverImage || '',
        audioUrl: audioUrl || '',
        artistBgImage: resolved.artistBgImage,
        savedToLibrary: savedToLib,
        sourceChannel
    });

    if (audioUrl && String(audioUrl).trim() && scheduleAudioMediaCheck) {
        scheduleAudioMediaCheck(wxOpenid, audioUrl, 'card_share', shareId);
    }

    return {
        ok: true,
        data: { shareId, templateId: resolved.templateId },
        meta: { hasCustomCover, musicId, senderId }
    };
}

function getShareDetail(shareId, req) {
    if (!shareId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '分享ID不能为空' };
    }

    const share = cardSharesRepo.findShareById(shareId);
    if (!share) {
        return { ok: false, error: ErrorCode.SHARE_NOT_FOUND };
    }

    let templateCategoryId = '';
    let textLayout = null;
    let charsPerLine = null;
    if (share.template_id) {
        const tpl = cardTemplates.getTemplateById(getDb(), share.template_id);
        if (tpl) {
            templateCategoryId = tpl.categoryId || '';
            textLayout = tpl.textLayout || null;
            charsPerLine = tpl.charsPerLine != null ? tpl.charsPerLine : null;
        }
    }

    const trackMeta = resolveShareTrackMeta(share.music_id);
    if (!share.audio_url && trackMeta.audioUrl) {
        share.audio_url = trackMeta.audioUrl;
    }

    return {
        ok: true,
        data: {
            shareId: share.id,
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient,
            message: share.message,
            template: share.template,
            templateId: share.template_id || '',
            templateCategoryId,
            textLayout,
            charsPerLine,
            workTitle: trackMeta.workTitle,
            musicCoverUrl: trackMeta.musicCoverUrl,
            durationSec: trackMeta.durationSec,
            musicInfo: {
                instrument: share.music_instrument,
                frequency: share.music_frequency,
                bpm: share.music_bpm
            },
            coverImage: sanitizeCardShareImageForClient(req, share.cover_image),
            audioUrl: share.audio_url,
            artistBgImage: sanitizeCardShareImageForClient(req, share.artist_bg_image),
            createdAt: share.created_at
        },
        meta: {
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient,
            workTitle: trackMeta.workTitle,
            hasCustomCover: !!(share.cover_image && String(share.cover_image).trim()),
            hasMusicCover: !!trackMeta.musicCoverUrl,
            durationSec: trackMeta.durationSec
        }
    };
}

function listMySavedShares(userId, limit = 50) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const rows = cardSharesRepo.listSavedSharesBySender(userId, limitNum);
    return rows.map(mapMyShareRow);
}

module.exports = {
    createShare,
    getShareDetail,
    listMySavedShares,
    isShareUuid: cardSharesRepo.isShareUuid
};
