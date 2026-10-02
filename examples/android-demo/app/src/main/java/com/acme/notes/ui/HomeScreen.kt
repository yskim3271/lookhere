package com.acme.notes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import com.acme.notes.R

/** Mixes the ways a Compose UI names things: string resources, literals, content descriptions, testTags. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun HomeScreen() {
    MaterialTheme {
        Surface(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
            Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.recent_notes), style = MaterialTheme.typography.headlineMedium)
                    Icon(Icons.Filled.Search, contentDescription = "Search notes")
                }
                Text("Groceries for the weekend")
                Text("Ideas for the launch post")
                Button(onClick = {}, modifier = Modifier.testTag("new_note_button")) {
                    Text("New note")
                }
            }
        }
    }
}
