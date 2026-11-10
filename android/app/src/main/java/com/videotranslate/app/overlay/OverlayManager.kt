package com.videotranslate.app.overlay

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.videotranslate.app.Card
import com.videotranslate.app.CaptureService
import com.videotranslate.app.Settings
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Painel flutuante sobre outros apps com as últimas frases EN + PT. Arrastável (barra do
 * topo), redimensionável (alça no canto inferior direito), com opacidade das configurações
 * e botões recolher/parar. Views clássicas, sem Compose, para rodar fora de uma Activity.
 */
class OverlayManager(private val context: Context, private val settings: Settings) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val root = LinearLayout(context)
    private val linesBox = LinearLayout(context)
    private val status = TextView(context)
    private val collapseBtn = Button(context)
    private val cards = ArrayList<Card>()
    private var collapsed = false
    private val params = WindowManager.LayoutParams(
        dp(340), WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START; x = dp(10); y = dp(80) }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), context.resources.displayMetrics).roundToInt()

    init {
        root.orientation = LinearLayout.VERTICAL
        root.background = GradientDrawable().apply { setColor(Color.argb((settings.overlayOpacity * 255).roundToInt(), 21, 23, 27)); cornerRadius = dp(12).toFloat() }
        root.setPadding(dp(10), dp(6), dp(10), dp(8))

        val bar = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        status.setTextColor(Color.argb(255, 154, 160, 168)); status.textSize = 11f; status.text = "Carregando…"
        status.layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        collapseBtn.text = "–"; styleButton(collapseBtn)
        collapseBtn.setOnClickListener { toggleCollapse() }
        val stopBtn = Button(context).apply { text = "✕"; styleButton(this); setOnClickListener { CaptureService.stop(context) } }
        bar.addView(status); bar.addView(collapseBtn); bar.addView(stopBtn)
        bar.setOnTouchListener(DragListener())
        root.addView(bar)

        linesBox.orientation = LinearLayout.VERTICAL
        root.addView(linesBox)

        val handle = TextView(context).apply { text = "◢"; setTextColor(Color.argb(140, 255, 255, 255)); textSize = 12f; gravity = Gravity.END }
        handle.setOnTouchListener(ResizeListener())
        root.addView(handle)
    }

    private fun styleButton(b: Button) {
        b.setTextColor(Color.WHITE); b.textSize = 12f; b.minWidth = 0; b.minimumWidth = 0; b.setPadding(dp(8), 0, dp(8), 0)
        b.background = GradientDrawable().apply { setColor(Color.argb(60, 255, 255, 255)); cornerRadius = dp(6).toFloat() }
        b.layoutParams = LinearLayout.LayoutParams(dp(34), dp(28)).apply { marginStart = dp(6) }
    }

    fun show() = main.post { runCatching { wm.addView(root, params) } }
    fun hide() = main.post { runCatching { wm.removeView(root) } }

    fun setStatus(text: String) = main.post { status.text = text }

    fun showCard(card: Card) = main.post {
        cards += card
        while (cards.size > settings.overlayLines) cards.removeAt(0)
        render()
    }

    fun updateTranslation(id: Int, pt: String) = main.post {
        val i = cards.indexOfFirst { it.id == id }
        if (i >= 0) { cards[i] = cards[i].copy(pt = pt); render() }
    }

    private fun render() {
        linesBox.removeAllViews()
        if (collapsed) return
        for (c in cards) {
            linesBox.addView(TextView(context).apply { text = c.en; setTextColor(Color.WHITE); textSize = settings.fontSp.toFloat(); setPadding(0, dp(4), 0, 0) })
            linesBox.addView(TextView(context).apply { text = c.pt ?: "…"; setTextColor(Color.argb(255, 63, 193, 169)); textSize = settings.fontSp * 0.95f })
        }
    }

    private fun toggleCollapse() {
        collapsed = !collapsed
        collapseBtn.text = if (collapsed) "+" else "–"
        linesBox.visibility = if (collapsed) View.GONE else View.VISIBLE
        render()
    }

    private inner class DragListener : View.OnTouchListener {
        private var sx = 0f; private var sy = 0f; private var ox = 0; private var oy = 0; private var moved = false
        override fun onTouch(v: View, e: MotionEvent): Boolean {
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { sx = e.rawX; sy = e.rawY; ox = params.x; oy = params.y; moved = false }
                MotionEvent.ACTION_MOVE -> {
                    params.x = ox + (e.rawX - sx).roundToInt(); params.y = oy + (e.rawY - sy).roundToInt()
                    if (abs(e.rawX - sx) > 8 || abs(e.rawY - sy) > 8) moved = true
                    runCatching { wm.updateViewLayout(root, params) }
                }
                MotionEvent.ACTION_UP -> if (!moved) v.performClick()
            }
            return true
        }
    }

    private inner class ResizeListener : View.OnTouchListener {
        private var sx = 0f; private var ow = 0
        override fun onTouch(v: View, e: MotionEvent): Boolean {
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { sx = e.rawX; ow = params.width }
                MotionEvent.ACTION_MOVE -> {
                    params.width = maxOf(dp(200), ow + (e.rawX - sx).roundToInt())
                    runCatching { wm.updateViewLayout(root, params) }
                }
            }
            return true
        }
    }
}
