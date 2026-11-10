package com.videotranslate.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

data class Card(val id: Int, val en: String, val pt: String? = null, val error: String? = null)

enum class CaptureState { IDLE, STARTING, LOADING_MODEL, LISTENING, ERROR }

data class UiState(
    val capture: CaptureState = CaptureState.IDLE,
    val statusText: String = "Parado",
    val progress: Float? = null,
    val cards: List<Card> = emptyList(),
    val partial: String = "",
    val translatorName: String = "",
    val error: String? = null,
    val level: Float = 0f,
)

/** Estado compartilhado entre o serviço de captura, a tela principal e o overlay. */
object TranscriptRepository {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    fun update(f: (UiState) -> UiState) = _state.update(f)

    fun reset() = _state.update { UiState() }

    fun addCard(card: Card) = _state.update { it.copy(cards = (it.cards + card).takeLast(500)) }

    fun setTranslation(id: Int, pt: String?, error: String?) = _state.update { s ->
        s.copy(cards = s.cards.map { if (it.id == id) it.copy(pt = pt, error = error) else it })
    }
}
