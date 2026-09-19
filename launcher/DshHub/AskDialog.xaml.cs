using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace DshHub;

public enum AskResult
{
    Cancel,
    Yes,
    No,
}

/// <summary>
/// Branded dark confirm dialog with 1..3 custom-labeled buttons
/// (used for "close should stop the service?" and "confirm update?").
/// </summary>
public partial class AskDialog : Window
{
    public AskResult Result { get; private set; } = AskResult.Cancel;

    public AskDialog(string title, string message)
    {
        InitializeComponent();
        Title = title;
        TitleText.Text = title;
        MessageText.Text = message;
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                Close();
            }
        };
    }

    public static AskResult Show(
        Window? owner,
        string title,
        string message,
        params (string label, AskResult result, bool primary)[] buttons)
    {
        var dlg = new AskDialog(title, message);
        if (owner is not null) dlg.Owner = owner;
        dlg.BuildButtons(buttons);
        dlg.ShowDialog();
        return dlg.Result;
    }

    private void BuildButtons((string label, AskResult result, bool primary)[] buttons)
    {
        foreach (var (label, result, primary) in buttons)
        {
            var btn = new Button
            {
                Content = label,
                Style = (Style)FindResource(primary ? "PrimaryButton" : "GhostButton"),
                Margin = new Thickness(8, 0, 0, 0),
                Padding = new Thickness(18, 8, 18, 8),
                MinWidth = 86,
            };
            btn.Click += (_, _) =>
            {
                Result = result;
                Close();
            };
            BtnHost.Children.Add(btn);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
