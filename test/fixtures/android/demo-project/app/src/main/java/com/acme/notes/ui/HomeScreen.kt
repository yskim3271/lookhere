package com.acme.notes.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.acme.notes.R

@Composable
fun HomeScreen(onNewNote: () -> Unit) {
    Column {
        Text(stringResource(R.string.recent_notes))
        Button(onClick = onNewNote, modifier = Modifier.testTag("new_note_button")) {
            Text("New note")
        }
        Icon(SearchIcon, contentDescription = "Search notes")
    }
}
