import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import MetricKit
import Network
import os
import SwiftUI
import UIKit

enum AppAudioSession {
    @discardableResult
    static func configureForVideoRecording() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .videoRecording,
                options: [.defaultToSpeaker]
            )
            try session.setPreferredSampleRate(48_000)
            if let builtInMic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
                try? session.setPreferredInput(builtInMic)
            }
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_recording")
            return true
        } catch {
            MediaPerformance.mark("audio_session_video_recording_failed")
            return false
        }
    }

    @discardableResult
    static func configureForVideoPlayback() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setPreferredSampleRate(48_000)
            try session.setActive(true)
            MediaPerformance.mark("audio_session_video_playback")
            return true
        } catch {
            MediaPerformance.mark("audio_session_video_playback_failed")
            return false
        }
    }
}

enum MediaDiagnostics {
    static func capturedVideoHasAudio(url: URL) async -> Bool {
        let asset = AVURLAsset(url: url)
        let audioTracks = try? await asset.loadTracks(withMediaType: .audio)

        guard let audioTrack = audioTracks?.first else {
            MediaPerformance.mark("capture_audio_missing")
            return false
        }

        let dataRate = Int((try? await audioTrack.load(.estimatedDataRate)) ?? 0)
        let formatDescription = try? await audioTrack.load(.formatDescriptions).first
        let streamDescription = formatDescription.flatMap {
            CMAudioFormatDescriptionGetStreamBasicDescription($0)
        }
        let sampleRate = Int(streamDescription?.pointee.mSampleRate ?? 0)
        let channels = Int(streamDescription?.pointee.mChannelsPerFrame ?? 0)
        let codec = formatDescription
            .map { fourCharacterCode(CMFormatDescriptionGetMediaSubType($0)) } ??
            "unknown"

        MediaPerformance.mark(
            "capture_audio codec=\(codec) sample_rate=\(sampleRate) channels=\(channels) bitrate=\(dataRate)"
        )
        return true
    }

    private static func fourCharacterCode(_ value: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff),
        ]

        return String(bytes: bytes, encoding: .macOSRoman) ?? "\(value)"
    }
}

