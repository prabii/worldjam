package com.worldjam.audio

import android.app.Activity
import android.content.Context
import com.google.ar.core.Anchor
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException

/**
 * ARCore world tracking for WorldJam.
 *
 * The design goal is that a captured object stays fixed to the physical spot
 * where it was recorded: point the phone away and back, and the mug's label is
 * still on the mug.
 *
 * ARCore owns the 3D truth (anchors in world space, camera pose per frame).
 * This class projects those anchors to 2D screen coordinates and hands them to
 * JS, so the existing React Native labels can be positioned without a 3D
 * renderer. That keeps the whole feature inside the native module already in
 * the app - no new third-party dependency, which matters given how much time
 * dependency mismatches have already cost this project.
 *
 * Every entry point degrades rather than throws: HLD v2 SS2 requires AR to be a
 * removable layer, so a device without ARCore must fall back to the 2D
 * placement path with no crash and no missing sound.
 */
class ArSessionManager(private val context: Context) {

    private var session: Session? = null
    private val anchors = mutableMapOf<String, Anchor>()

    /** Last known camera pose validity, so JS can show a "move your phone" hint. */
    @Volatile
    var tracking: Boolean = false
        private set

    @Volatile
    var lastError: String? = null
        private set

    /** ARCore availability without installing anything. */
    fun isSupported(): Boolean = try {
        ArCoreApk.getInstance().checkAvailability(context).isSupported
    } catch (e: Throwable) {
        lastError = e.message
        false
    }

    /**
     * Creates the ARCore session.
     *
     * @return true when AR is live; false means the caller should use the 2D
     *         fallback. Never throws.
     */
    fun start(activity: Activity?): Boolean {
        if (session != null) return true

        return try {
            if (!isSupported()) {
                lastError = "ARCore not supported on this device"
                return false
            }

            // requestInstall shows Google's installer if ARCore is missing or
            // stale. A null activity means we cannot prompt, so bail to 2D.
            if (activity != null) {
                val status = ArCoreApk.getInstance().requestInstall(activity, true)
                if (status == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    lastError = "ARCore install requested; retry after it completes"
                    return false
                }
            }

            val s = Session(context)
            s.configure(
                Config(s).apply {
                    // LATEST_CAMERA_IMAGE keeps update() non-blocking, which
                    // matters because the audio path must never wait on AR.
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                    planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                    lightEstimationMode = Config.LightEstimationMode.DISABLED
                    // Depth improves hit-test accuracy on supported devices and
                    // is simply ignored where it is not.
                    depthMode = if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                        Config.DepthMode.AUTOMATIC
                    } else {
                        Config.DepthMode.DISABLED
                    }
                },
            )
            session = s
            lastError = null
            true
        } catch (e: UnavailableException) {
            lastError = "ARCore unavailable: ${e.message}"
            false
        } catch (e: Throwable) {
            lastError = e.message ?: "ARCore failed to start"
            false
        }
    }

    fun resume(): Boolean = try {
        session?.resume()
        true
    } catch (e: CameraNotAvailableException) {
        lastError = "Camera not available for AR"
        false
    } catch (e: Throwable) {
        lastError = e.message
        false
    }

    fun pause() {
        try {
            session?.pause()
        } catch (_: Throwable) {
        }
    }

    fun stop() {
        for (a in anchors.values) {
            try {
                a.detach()
            } catch (_: Throwable) {
            }
        }
        anchors.clear()
        try {
            session?.close()
        } catch (_: Throwable) {
        }
        session = null
        tracking = false
    }

    fun setDisplayGeometry(rotation: Int, width: Int, height: Int) {
        try {
            session?.setDisplayGeometry(rotation, width, height)
        } catch (_: Throwable) {
        }
    }

    /**
     * Advances the AR frame. Must be called once per render frame.
     * Returns false when the pose is not yet trackable.
     */
    private fun currentFrame(): Frame? {
        val s = session ?: return null
        return try {
            val frame = s.update()
            tracking = frame.camera.trackingState == TrackingState.TRACKING
            frame
        } catch (e: Throwable) {
            tracking = false
            null
        }
    }

    /**
     * Places a world anchor at the given screen point.
     *
     * Tries a plane/depth hit first (a real surface in the room); falls back to
     * projecting a point one metre in front of the camera so a capture is never
     * refused just because ARCore has not found a plane yet.
     *
     * @return the anchor id, or null if AR is not tracking.
     */
    fun createAnchorAt(id: String, screenX: Float, screenY: Float): Boolean {
        val frame = currentFrame() ?: return false
        if (!tracking) return false

        return try {
            val hit = frame.hitTest(screenX, screenY).firstOrNull { h ->
                val t = h.trackable
                // Only accept a point that is actually on a detected surface;
                // an unconstrained hit can land behind the camera.
                (t is Plane && t.isPoseInPolygon(h.hitPose)) ||
                    t is com.google.ar.core.DepthPoint ||
                    t is com.google.ar.core.Point
            }

            val anchor = if (hit != null) {
                hit.createAnchor()
            } else {
                // No surface found: pin it a metre ahead of the camera so the
                // object still has a stable world position.
                val camPose = frame.camera.pose
                val forward = camPose.compose(
                    com.google.ar.core.Pose.makeTranslation(0f, 0f, -1.0f),
                )
                session?.createAnchor(forward)
            } ?: return false

            anchors[id]?.detach()
            anchors[id] = anchor
            true
        } catch (e: Throwable) {
            lastError = e.message
            false
        }
    }

    fun removeAnchor(id: String) {
        anchors.remove(id)?.let {
            try {
                it.detach()
            } catch (_: Throwable) {
            }
        }
    }

    /**
     * Projects every anchor to screen space for the current frame.
     *
     * Returns a flat list: [id, x, y, depth, visible] per anchor, where x/y are
     * pixels and `visible` is 0/1. A flat array rather than objects keeps the
     * per-frame bridge cost low - this is called ~30x a second.
     */
    fun projectAnchors(viewWidth: Int, viewHeight: Int): List<Any> {
        val frame = currentFrame() ?: return emptyList()
        if (!tracking) return emptyList()

        val out = mutableListOf<Any>()
        val camera = frame.camera

        val projection = FloatArray(16)
        val view = FloatArray(16)
        // Near/far chosen for room scale; anything beyond 30m is not a
        // tabletop instrument.
        camera.getProjectionMatrix(projection, 0, 0.1f, 30f)
        camera.getViewMatrix(view, 0)

        val viewProjection = FloatArray(16)
        android.opengl.Matrix.multiplyMM(viewProjection, 0, projection, 0, view, 0)

        val world = FloatArray(4)
        val clip = FloatArray(4)

        for ((id, anchor) in anchors) {
            if (anchor.trackingState != TrackingState.TRACKING) {
                out.add(id); out.add(0.0); out.add(0.0); out.add(0.0); out.add(0)
                continue
            }

            val t = anchor.pose.translation
            world[0] = t[0]; world[1] = t[1]; world[2] = t[2]; world[3] = 1f

            android.opengl.Matrix.multiplyMV(clip, 0, viewProjection, 0, world, 0)

            // w <= 0 means the point is behind the camera.
            if (clip[3] <= 0f) {
                out.add(id); out.add(0.0); out.add(0.0); out.add(0.0); out.add(0)
                continue
            }

            val ndcX = clip[0] / clip[3]
            val ndcY = clip[1] / clip[3]

            val sx = (ndcX + 1f) * 0.5f * viewWidth
            // NDC y is up, screen y is down.
            val sy = (1f - ndcY) * 0.5f * viewHeight

            val camT = camera.pose.translation
            val dx = t[0] - camT[0]
            val dy = t[1] - camT[1]
            val dz = t[2] - camT[2]
            val distance = kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)

            val onScreen = sx >= -200 && sx <= viewWidth + 200 &&
                sy >= -200 && sy <= viewHeight + 200

            out.add(id)
            out.add(sx.toDouble())
            out.add(sy.toDouble())
            out.add(distance.toDouble())
            out.add(if (onScreen) 1 else 0)
        }
        return out
    }

    /** Camera pose, for spatial audio panning based on where the user faces. */
    fun cameraPose(): List<Double> {
        val frame = currentFrame() ?: return emptyList()
        if (!tracking) return emptyList()
        val p = frame.camera.pose
        val t = p.translation
        val q = p.rotationQuaternion
        return listOf(
            t[0].toDouble(), t[1].toDouble(), t[2].toDouble(),
            q[0].toDouble(), q[1].toDouble(), q[2].toDouble(), q[3].toDouble(),
        )
    }

    fun anchorCount(): Int = anchors.size
}
