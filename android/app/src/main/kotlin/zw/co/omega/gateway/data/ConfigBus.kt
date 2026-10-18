package zw.co.omega.gateway.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** In-process signal "the cached shift config changed". The monitoring coordinator wakes on it. */
object ConfigBus {
    private val _changes = MutableStateFlow(0L)
    val changes: StateFlow<Long> get() = _changes
    fun notifyChanged() { _changes.value = System.nanoTime() }
}
